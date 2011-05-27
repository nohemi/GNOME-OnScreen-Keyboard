/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const St = imports.gi.St;

const Main = imports.ui.main;

function Keyboard() {
    this._init.apply(this, arguments);
}

Keyboard.prototype = {
    _init: function () {
        this.actor = new St.BoxLayout({ name: 'keyboard' });
        let k0 = new St.Button({ style_class: 'keyboard-key',
                                 label: '0' });
        k0.connect('clicked', function () { global.fake_key_press('0'); });
        this.actor.add_actor(k0);
        let k1 = new St.Button({ style_class: 'keyboard-key',
                                 label: '1' });
        k1.connect('clicked', function () { global.fake_key_press('1'); });
        this.actor.add_actor(k1);

        global.screen.connect('monitors-changed', Lang.bind(this, this._reposition));
        this.actor.connect('allocation-changed', Lang.bind(this, this._reposition));

        Main.chrome.addActor(this.actor, { visibleInOverview: true,
                                           visibleInFullscreen: true,
                                           affectsStruts: false });

        this._reposition();
    },

    _reposition: function () {
        let primary = global.get_primary_monitor();
        this.actor.x = primary.x;
        this.actor.y = primary.y + primary.height - this.actor.height;
    },

    show: function () {
        this.actor.show();
    },

    hide: function () {
        this.actor.hide();
    }
};
