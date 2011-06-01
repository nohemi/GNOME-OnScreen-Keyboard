/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

const Clutter = imports.gi.Clutter;
const Gdk = imports.gi.Gdk;
const Lang = imports.lang;
const St = imports.gi.St;
const Shell = imports.gi.Shell;
const Caribou = imports.gi.Caribou;

const Main = imports.ui.main;

const Pretty_Keys = [
    {name: "BackSpace", label: "\u232b"},
    {name: "space", label: " "},
    {name: "Return", label: "\u23ce"},
    {name: "Caribou_Prefs", label: "\u2328"},
    {name: "Caribou_ShiftUp", label: "\u2b06"},
    {name: "Caribou_ShiftDown", label: "\u2b07"},
    {name: "Caribou_Emoticons", label: "\u263a"},
    {name: "Caribou_Symbols", label: "123"},
    {name: "Caribou_Symbols_More", label: "{#*"},
    {name: "Caribou_Alpha", label: "Abc"}
]

function Key(key) {
    this._init(key);
}

Key.prototype = {
    _init : function(key) {
       this.key = key;
       if (this.key.name == "Caribou_Prefs")
           this.key.connect('key-clicked', Lang.bind(this,this._onPrefsClick));
       this.extended_keys = new St.BoxLayout({ name: 'keyboard-row'});
    },

    getKey: function () {
        let label = this.key.name;

        if (this.key.name.length > 1) {
            let foundPretty = false;

            for (var i = 0; i < Pretty_Keys.length; ++i) {
                if (this.key.name == Pretty_Keys[i].name) {
                    label = Pretty_Keys[i].label;
                    foundPretty = true;
                    break;
                }
            }

            if (!foundPretty) {
                let keyval = this.key.keyval;
                let unichar = Gdk.keyval_to_unicode(this.key.keyval);
                if (unichar)
                    label = String.fromCharCode(unichar);
            }
        }

        let button = new St.Button ({ label: label, style_class: 'keyboard-key'});

        button.connect('button-press-event', Lang.bind(this, function () { this.key.press(); }));
        button.connect('button-release-event', Lang.bind(this, function () { this.key.release(); }));

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
