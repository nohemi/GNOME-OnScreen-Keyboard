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
        if (this.key.name.length > 1) {
            for (var i = 0; i < Pretty_Keys.length; ++i) {
                if (this.key.name == Pretty_Keys[i].name)
                    return Pretty_Keys[i].button;
            }
        }
        //let label = new String (this.key.name);
        //let button = new St.Button({ label: label, style_class: 'keyboard-key'});
        //button.connect('clicked', function () { global.fake_key_press(label.charAt(0)); });
        let button = new St.Button ({ label: this.key.name, style_class: 'keyboard-key'});
        return button;
     }
};

function Layout(level) {
   this._init(level);
}

Layout.prototype = {
    _init : function (level) {
        this.layout = new St.BoxLayout({ name: 'keyboard', vertical: 'false' });;
        this.level = level;
        this.loadRows();
    },

    addRows : function (keys, row_num) {
        let box = new St.BoxLayout ({ name: 'keyboard-row'});
        for each (key in keys) {
            let button = new Key(key);
            box.add(button.getSym());
        }
        this.layout.add(box);
    },

    loadRows : function () {
        let rows = this.level.get_rows();
        let row_num = 0;
        for each (row in rows) {
           this.addRows(row.get_keys(), row_num);
           row_num ++;
        }
    }
};

function Keyboard() {
    this._init.apply(this, arguments);
}

Keyboard.prototype = {
    _init: function () {
        this.actor = new St.BoxLayout({ name: 'keyboard', vertical: 'false' });
        this.actor1 = new St.BoxLayout({ name: 'keyboard', vertical: 'false' });
        this.actor2 = new St.BoxLayout({ name: 'keyboard', vertical: 'false' });
        this.actor3 = new St.BoxLayout({ name: 'keyboard', vertical: 'false' });

        this.keyboard = new Caribou.KeyboardModel();

        this.layers = {};
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
             let group = this.keyboard.get_group(gname);
             group.connect("notify::active-level", this._onLevelChanged)
             /*for each (lname in group.get_levels()) {
                 let level = group.get_level(lname);
                 let layout = new Layout(level);
                 this.layers[lname]= layout;
                 this.actor.add(layout.layout);
                 layout.layout.show()
             }*/
             let levels = group.get_levels();
             let level1 = group.get_level(levels[1]);
             let layout = new St.BoxLayout({ name: 'keyboard', vertical: 'false' });
             this._loadRows(level1,layout);
             this.actor.add(layout);
             layout.hide();
            /* let level2 = group.get_level(levels[0]);
             let layout1 = new Layout(level2);
             this.actor1.add(layout1.layout);
             this.actor1.show();*/
        }
        this._setActiveLayer();
    },

       addRows : function (keys,layout) {
        let box = new St.BoxLayout ({ name: 'keyboard-row'});
        for each (key in keys) {
            let button = new Key(key);
            box.add(button.getSym());
        }
        layout.add(box);
    },

    _loadRows : function (level,layout) {
        let rows = level.get_rows();
        for each (row in rows) {
           this.addRows(row.get_keys(),layout);
        }
    },

    _onLevelChanged: function () {
        this._setActiveLayer();
    },

    _setActiveLayer: function () {
        let active_group_name = this.keyboard.active_group;
        let active_group = this.keyboard.get_group(active_group_name);
        let active_level = active_group.active_level;
      //  let layer = this.layers[active_level];
      //  this.actor.add(layer.layout);
      //  layer.layout.show();
    },

    show: function () {
        this.actor.show();
    },

    hide: function () {
        this.actor.hide();
    }
};
