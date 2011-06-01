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
       this.key.connect('key-pressed', Lang.bind(this,this._onClick));
       this.key.connect('key-released', Lang.bind(this,this._onRelease));
       this.extended_keys = new St.BoxLayout({ name: 'keyboard-row'});
    },

    getKey: function () {
        if (this.key.name.length > 1) {
            for (var i = 0; i < Pretty_Keys.length; ++i) {
                if (this.key.name == Pretty_Keys[i].name)
                    return Pretty_Keys[i].button;
                if (this.key.name == "Caribou_Prefs")
                    this.key.connect('key-clicked', Lang.bind(this,this._onPrefsClick));
            }
        }
        let charAt = new String (this.key.name);
        let button = new St.Button ({ label: this.key.name, style_class: 'keyboard-key'});
        button.connect('clicked', function () { global.fake_key_press(charAt.charAt(0)); });
    /*    if (this.key.get_extended_keys() != null) {
            this.key.connect("notify::show-subkeys", Lang.bind(this,this._onShowSubkeys));
            for each (key in key.get_extended_keys()) {
                let extended_key = new St.Button ({ label: key.name, style_class: 'keyboard-key'});
                this.extended_keys.add(extended_key);
            }
            this.extended_keys.hide();
        }*/
        return button;
     },

     _onPrefsClick: function () {
     },

     _onShowSubkeys: function () {
          if (this.key.show_sub_keys) {
              this.extended_keys.show();
          } else {
              this.extended_keys.hide();
          }
     },

     _onClick: function () {
         this.key.press();
     },

     _onRelease: function () {
         this.key.release();
     }
};

function Keyboard() {
    this._init.apply(this, arguments);
}

Keyboard.prototype = {
    _init: function () {
        this.actor = new St.BoxLayout({ name: 'keyboard', vertical: 'false' });

        this.keyboard = new Caribou.KeyboardModel();

        this.groups = {};
        this.addKeys();

        this.keyboard.connect("notify::active-group", Lang.bind(this,this._onGroupChanged));
        global.screen.connect('monitors-changed', Lang.bind(this, this._reposition));
        this.actor.connect('allocation-changed', Lang.bind(this, this._reposition));

        Main.chrome.addActor(this.actor, { visibleInOverview: true,
                                           visibleInFullscreen: true,
                                           affectsStruts: false });

        this.current_page = null;
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
             group.connect("notify::active-level", Lang.bind(this,this._onLevelChanged));
             let layers = {};
             for each (lname in group.get_levels()) {
                 let level = group.get_level(lname);
                 let layout = new St.BoxLayout({ name: 'keyboard', vertical: 'false' });
                 this._loadRows(level,layout);
                 layers[lname]= layout;
                 this.actor.add(layout);
                 layout.hide()
             }
             this.groups[gname] = layers;
        }
        this._setActiveLayer();
    },

    addRows : function (keys,layout) {
        let box = new St.BoxLayout ({ name: 'keyboard-row'});
        for each (key in keys) {
            let button = new Key(key);
            box.add(button.getKey());
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

    _onGroupChanged: function () {
        this._setActiveLayer();
    },

    _setActiveLayer: function () {
        let active_group_name = this.keyboard.active_group;
        let active_group = this.keyboard.get_group(active_group_name);
        let active_level = active_group.active_level;
        let layers = this.groups[active_group_name];

        if (this.current_page != null) {
            this.current_page.hide()
        }

        this.current_page = layers[active_level];
        layers[active_level].show();
    },

    show: function () {
        this.actor.show();
    },

    hide: function () {
        this.actor.hide();
    }
};
