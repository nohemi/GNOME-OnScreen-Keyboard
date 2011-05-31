/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const St = imports.gi.St;
const Shell = imports.gi.Shell;
const Caribou = imports.gi.Caribou;

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

function Key(key) {
    this._init(key);
}

Key.prototype = {
    _init : function(key) {
       this.key = key;
    },

    getSym : function() {
        if (this.key.get_name().length > 1) {
            for (var i = 0; i < Pretty_Keys.length; ++i) {
                if (this.key.get_name() == Pretty_Keys[i].name)
                    return Pretty_Keys[i].button;
            }
        }
        let label = new String (this.key.get_name());
        let button = new St.Button({ label: label, style_class: 'keyboard-key'});
        button.connect('clicked', function () { global.fake_key_press(label.charAt(0)); });
        return button;
     }
};

function Layout(level) {
   this._init(level);
}

Layout.prototype = {
    _init : function (level) {
        this.box = new St.BoxLayout ({ name: 'keyboard-row'});
        this.level = level;
        this.loadRows();
    },

    addRows : function (keys) {
        for each (key in keys) {
            let button = new Key(key);
            this.box.add(button.getSym());
        }
    },

    loadRows : function () {
        let rows = this.level.get_rows();
        for each (row in rows) {
           this.addRow(row.get_keys())
        }
    }
};

function Keyboard() {
    this._init.apply(this, arguments);
}

Keyboard.prototype = {
    _init: function () {
        this.actor = new St.BoxLayout({ name: 'keyboard', vertical: 'false' });
        this.keyboard = new Caribou.KeyboardModel();

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
        for each (gname in this.keyboard.get_groups()) {
             group = this.keyboard.get_group(gname);
             for each (lname in group.get_levels()) {
                 let level = group.get_level(lname);
                 let layout = new Layout(level);
             }
        }
    },

    show: function () {
        this.actor.show();
    },

    hide: function () {
        this.actor.hide();
    }
};
