/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const St = imports.gi.St;
const Shell = imports.gi.Shell;

const Main = imports.ui.main;

const Pretty_Keys = [
    {name: "BackSpace", button: new St.Button({ label: "\u232b", style_class: 'keyboard-key'})},
    {name: "space", button: new St.Button({ label: " ", style_class: 'keyboard-key'})},
    {name: "Return", button: new St.Button({ label: "\u23ce", style_class: 'keyboard-key'})},
    {name: "Caribou_Prefs", button: new St.Button({ label: "\u2328", style_class: 'keyboard-key'})},
    {name: "Caribou_ShiftUp", button: new St.Button({ label: "\u2b06", style_class: 'keyboard-key'})},
    {name: "Caribou_ShiftDown", button: new St.Button({ label: "\u2b07", style_class: 'keyboard-key'})},
    {name: "Caribou_Emoticons", button: new St.Button({ label: "\u263a", style_class: 'keyboard-key'})},
    {name: "Caribou_Symbols", button: new St.Button({ label: "123", style_class: 'keyboard-key'})},
    {name: "Caribou_Symbols_More", button: new St.Button({ label: "{#*", style_class: 'keyboard-key'})},
    {name: "Caribou_Alpha", button: new St.Button({ label: "Abc", style_class: 'keyboard-key'})}
]

function Key(label) {
    this._init(label);
}

Key.prototype = {
    _init : function(label) {
       this.label = label;
    },

    getSym : function() {
        if (this.label.length > 1) {
            for (var key = 0; key < Pretty_Keys.length; ++key) {
                if (this.label == Pretty_Keys[key].name)
                    return Pretty_Keys[key].button;
            }
        }
        return new St.Button({ label: this.label, style_class: 'keyboard-key'});
    }
};

function Keyboard() {
    this._init.apply(this, arguments);
}

Keyboard.prototype = {
    _init: function () {
        this.actor = new St.BoxLayout({ name: 'keyboard', vertical: 'false' });
        let file_contents = Shell.get_file_contents_utf8_sync('/home/nohemi/gnome-shell/source/caribou/data/layouts/touch/us.json');
        this.layout = JSON.parse(file_contents);

        this.addKeys();

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

    addKeys: function () {
        for (var row = 0; row < this.layout.level1.rows.length; ++row) {
            let box = new St.BoxLayout ({name: 'keyboard-row' });
            for (var key = 0; key < this.layout.level1.rows[row].length; ++key) {
                let button = new Key(this.layout.level1.rows[row][key].name);
                box.add(button.getSym());
            }
            this.actor.add_actor(box);
        }
    },

    show: function () {
        this.actor.show();
    },

    hide: function () {
        this.actor.hide();
    }
};
