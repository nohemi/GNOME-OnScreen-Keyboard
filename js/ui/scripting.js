/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Mainloop = imports.mainloop;

const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;

// This module provides functionality for driving the shell user interface
// in an automated fashion. The primary current use case for this is
// automated performance testing (see runPerfScript()), but it could
// be applied to other forms of automation, such as testing for
// correctness as well.
//
// When scripting an automated test we want to make a series of calls
// in a linear fashion, but we also want to be able to let the main
// loop run so actions can finish. For this reason we write the script
// as a generator function that yields when it want to let the main
// loop run.
//
//    yield Scripting.sleep(1000);
//    main.overview.show();
//    yield Scripting.waitLeisure();
//
// While it isn't important to the person writing the script, the actual
// yielded result is a function that the caller uses to provide the
// callback for resuming the script.

/**
 * sleep:
 * @milliseconds: number of milliseconds to wait
 *
 * Used within an automation script to pause the the execution of the
 * current script for the specified amount of time. Use as
 * 'yield Scripting.sleep(500);'
 */
function sleep(milliseconds) {
    let cb;

    Mainloop.timeout_add(milliseconds, function() {
                             if (cb)
                                 cb();
                             return false;
                         });

    return function(callback) {
        cb = callback;
    };
}

/**
 * waitLeisure:
 *
 * Used within an automation script to pause the the execution of the
 * current script until the shell is completely idle. Use as
 * 'yield Scripting.waitLeisure();'
 */
function waitLeisure() {
    let cb;

    global.run_at_leisure(function() {
                             if (cb)
                                 cb();
                          });

    return function(callback) {
        cb = callback;
    };
}

/**
 * defineScriptEvent
 * @name: The event will be called script.<name>
 * @description: Short human-readable description of the event
 *
 * Convenience function to define a zero-argument performance event
 * within the 'script' namespace that is reserved for events defined locally
 * within a performance automation script
 */
function defineScriptEvent(name, description) {
    Shell.PerfLog.get_default().define_event("script." + name,
                                             description,
                                             "");
}

/**
 * scriptEvent
 * @name: Name registered with defineScriptEvent()
 *
 * Convenience function to record a script-local performance event
 * previously defined with defineScriptEvent
 */
function scriptEvent(name) {
    Shell.PerfLog.get_default().event("script." + name);
}

/**
 * collectStatistics
 *
 * Convenience function to trigger statistics collection
 */
function collectStatistics() {
    Shell.PerfLog.get_default().collect_statistics();
}

function _step(g, finish, onError) {
    try {
        let waitFunction = g.next();
        waitFunction(function() {
                         _step(g, finish, onError);
                     });
    } catch (err if err instanceof StopIteration) {
        if (finish)
            finish();
    } catch (err) {
        if (onError)
            onError(err);
    }
}

function _collect(scriptModule, outputFile) {
    let eventHandlers = {};

    for (let f in scriptModule) {
        let m = /([A-Za-z]+)_([A-Za-z]+)/.exec(f);
        if (m)
            eventHandlers[m[1] + "." + m[2]] = scriptModule[f];
    }

    Shell.PerfLog.get_default().replay(
        function(time, eventName, signature, arg) {
            if (eventName in eventHandlers)
                eventHandlers[eventName](time, arg);
        });

    if ('finish' in scriptModule)
        scriptModule.finish();

    if (outputFile) {
        let f = Gio.file_new_for_path(outputFile);
        let raw = f.replace(null, false,
                            Gio.FileCreateFlags.NONE,
                            null);
        let out = Gio.BufferedOutputStream.new_sized (raw, 4096);
        Shell.write_string_to_stream (out, "{\n");

        Shell.write_string_to_stream(out, '"events":\n');
        Shell.PerfLog.get_default().dump_events(out);

        Shell.write_string_to_stream(out, ',\n"metrics":\n[ ');
        let first = true;
        for (let name in scriptModule.METRICS) {
            let value = scriptModule.METRICS[name];
            let description = scriptModule.METRIC_DESCRIPTIONS[name];

            if (!first)
                Shell.write_string_to_stream(out, ',\n  ');
            first = false;

            Shell.write_string_to_stream(out,
                                         '{ "name": ' + JSON.stringify(name) + ',\n' +
                                         '    "description": ' + JSON.stringify(description) + ',\n' +
                                         '    "value": ' + JSON.stringify(value) + ' }');
        }
        Shell.write_string_to_stream(out, ' ]');

        Shell.write_string_to_stream (out, ',\n"log":\n');
        Shell.PerfLog.get_default().dump_log(out);

        Shell.write_string_to_stream (out, '\n}\n');
        out.close(null);
    } else {
        let metrics = [];
        for (let metric in scriptModule.METRICS)
            metrics.push(metric);

        metrics.sort();

        print ('------------------------------------------------------------');
        for (let i = 0; i < metrics.length; i++) {
            let metric = metrics[i];
            print ('# ' + scriptModule.METRIC_DESCRIPTIONS[metric]);
            print (metric + ': ' +  scriptModule.METRICS[metric]);
        }
        print ('------------------------------------------------------------');
    }
}

/**
 * runPerfScript
 * @scriptModule: module object with run and finish functions
 *    and event handlers
 *
 * Runs a script for automated collection of performance data. The
 * script is defined as a Javascript module with specified contents.
 *
 * First the run() function within the module will be called as a
 * generator to automate a series of actions. These actions will
 * trigger performance events and the script can also record its
 * own performance events.
 *
 * Then the recorded event log is replayed using handler functions
 * within the module. The handler for the event 'foo.bar' is called
 * foo_bar().
 *
 * Finally if the module has a function called finish(), that will
 * be called.
 *
 * The event handler and finish functions are expected to fill in
 * metrics to an object within the module called METRICS. The module
 * should also have an object called METRIC_DESCRIPTIONS with
 * descriptions for each metric that will be written into METRIC.
 *
 * The resulting metrics will be written to @outputFile as JSON, or,
 * if @outputFile is not provided, logged.
 *
 * After running the script and collecting statistics from the
 * event log, GNOME Shell will exit.
 **/
function runPerfScript(scriptModule, outputFile) {
    Shell.PerfLog.get_default().set_enabled(true);

    let g = scriptModule.run();

    _step(g,
          function() {
              _collect(scriptModule, outputFile);
              Meta.exit(Meta.ExitCode.SUCCESS);
          },
         function(err) {
             log("Script failed: " + err + "\n" + err.stack);
             Meta.exit(Meta.ExitCode.ERROR);
         });
}