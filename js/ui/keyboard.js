/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

const Caribou = imports.gi.Caribou;
const Clutter = imports.gi.Clutter;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const BoxPointer = imports.ui.boxpointer;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const PopupMenu = imports.ui.popupMenu;

//Measurements used for keyboard display
const PADDING = 10;
const VERT_SPACING = 10;
const HORIZ_SPACING = 15;
const NUM_OF_VERT_KEYS = 4;
const NUM_OF_HORIZ_KEYS = 11;

const KEYBOARD_SCHEMA = 'org.gnome.shell.keyboard';
const SHOW_KEYBOARD_KEY = 'show-keyboard';
//Key constants taken from Antler
const PRETTY_KEYS = [
    { name: "BackSpace", label: "\u232b" },
    { name: "space", label: " " },
    { name: "Return", label: "\u23ce" },
    { name: "Caribou_Prefs", label: "\u2328" },
    { name: "Caribou_ShiftUp", label: "\u2b06" },
    { name: "Caribou_ShiftDown", label: "\u2b07" },
    { name: "Caribou_Emoticons", label: "\u263a" },
    { name: "Caribou_Symbols", label: "123" },
    { name: "Caribou_Symbols_More", label: "{#*" },
    { name: "Caribou_Alpha", label: "Abc" }
];

function Key() {
    this._init.apply(this, arguments);
}

Key.prototype = {
    _init : function(key) {
        this._key = key;

        //Measurements for keyboard display
        let primary_monitor = global.get_primary_monitor();
        this._width = (primary_monitor.width - (NUM_OF_HORIZ_KEYS - 1) * HORIZ_SPACING
                        - 2 * PADDING)/ NUM_OF_HORIZ_KEYS  * this._key.width;
        this._height = (primary_monitor.height/3 - (NUM_OF_VERT_KEYS - 1) * VERT_SPACING
                         - 2 * PADDING) / NUM_OF_VERT_KEYS;

        this.actor = this._getKey();

        this._extended_keys = this._key.get_extended_keys();
        this._extended_keyboard = {};

        if (this._extended_keys.length > 0) {
            this._grabbed = false;
            this._eventCaptureId = 0;
            this._key.connect('notify::show-subkeys', Lang.bind(this, this._onShowSubkeys));
            this._boxPointer = new BoxPointer.BoxPointer(St.Side.BOTTOM,
                                                   { style_class: 'keyboard-subkeys',
                                                     x_fill: true,
                                                     y_fill: true,
                                                     x_align: St.Align.START });
            this._getExtendedKeys();
            this._boxPointer.actor.hide();
            Main.chrome.addActor(this._boxPointer.actor, { visibleInOverview: true,
                                                     visibleInFullscreen: true,
                                                     affectsStruts: false });
        }
    },

    _getKey: function () {
        let label = this._key.name;

        if (this._key.name.length > 1) {
            let foundPretty = false;

            for (var i = 0; i < PRETTY_KEYS.length; ++i) {
                if (this._key.name == PRETTY_KEYS[i].name) {
                    label = PRETTY_KEYS[i].label;
                    foundPretty = true;
                    break;
                }
            }

            if (!foundPretty) {
                label = this._getUnichar(this._key);
            }
        }

        label = GLib.markup_escape_text(label, -1);
        let button = new St.Button ({ label: label, style_class: 'keyboard-key' });

        button.width = this._width;
        button.height = this._height;
        button.connect('button-press-event', Lang.bind(this, function () { this._key.press(); }));
        button.connect('button-release-event', Lang.bind(this, function () { this._key.release(); }));

        return button;
    },

    _getUnichar: function(key) {
        let keyval = key.keyval;
        let unichar = Gdk.keyval_to_unicode(keyval);
        if (unichar) {
            return String.fromCharCode(unichar);
        } else {
            return key.name;
        }
    },

    _getExtendedKeys: function () {
        this._extended_keyboard = new St.BoxLayout({ style_class: 'keyboard-layout',
                                                     vertical: false });
        for (let i = 0; i < this._extended_keys.length; i++) {
            let extended_key = this._extended_keys[i];
            let label = this._getUnichar(extended_key);
            let key = new St.Button({ label: label, style_class: 'keyboard-key' });
            key.width = this._width;
            key.height = this._height;
            key.connect('button-press-event', Lang.bind(this, function () { extended_key.press(); }));
            key.connect('button-release-event', Lang.bind(this, function () { extended_key.release(); }));
            this._extended_keyboard.add(key);
        }
        this._boxPointer.bin.add_actor(this._extended_keyboard);
    },

    _onEventCapture: function (actor, event) {
        if (event.type() == Clutter.EventType.BUTTON_PRESS) {
            if (this._extended_keyboard.contains(event.get_source())) {
                this._ungrab();
                return false;
            }
            this._boxPointer.actor.hide();
            this._ungrab();
            return true;
        }
        return false;
    },

    _ungrab: function () {
        global.stage.disconnect(this._eventCaptureId);
        this._eventCaptureId = 0;
        this._grabbed = false;
        Main.popModal(this.actor);
    },

    _onShowSubkeys: function () {
        if (this._key.show_subkeys) {
            this.actor.fake_release();
            this._boxPointer.actor.raise_top();
            this._boxPointer.setPosition(this.actor, 5, 0.5);
            this._boxPointer.show(true);
            this.actor.set_hover(false);
            if (!this._grabbed) {
                 Main.pushModal(this.actor);
                 this._eventCaptureId = global.stage.connect('captured-event', Lang.bind(this, this._onEventCapture));
                 this._grabbed = true;
            }
        } else {
            if (this._grabbed)
                this._ungrab();
            this._boxPointer.hide(true);
        }
    }
};

function Keyboard() {
    this._init.apply(this, arguments);
}

Keyboard.prototype = {
    _init: function () {
        this.actor = new St.BoxLayout({ name: 'keyboard', vertical: 'false' });

        this._keyboard = new Caribou.KeyboardModel();
        this.showKeyboard = true;

        this._groups = {};
        this._current_page = null;

        this._addKeys();
        this._keyboardSettings = new Gio.Settings({ schema: KEYBOARD_SCHEMA });
        this._keyboardSettings.connect('changed', Lang.bind(this, this._onSettingsChange));

        this._keyboard.connect('notify::active-group', Lang.bind(this, this._onGroupChanged));
        global.screen.connect('monitors-changed', Lang.bind(this, this._reposition));
        this.actor.connect('allocation-changed', Lang.bind(this, this._queueReposition));
        Main.chrome.addActor(this.actor, { visibleInOverview: true,
                                           visibleInFullscreen: true,
                                           affectsStruts: true });
        this._reposition();
        this._display();
    },

    _display: function () {
        let showKeyboardKey = this._keyboardSettings.get_boolean(SHOW_KEYBOARD_KEY);
        if (showKeyboardKey) {
            this.show();
        } else {
            this.hide();
        }
    },

    _onSettingsChange: function () {
        this._display();
        Main.overview.relayout();
    },

    _reposition: function () {
        let primary = global.get_primary_monitor();
        this.actor.x = primary.x;
        this.actor.y = primary.y + primary.height - this.actor.height;
        this.actor.height = primary.height / 3;
    },

    _queueReposition: function () {
        Mainloop.timeout_add(0, Lang.bind(this, function () { this._reposition(); }));
    },

    _addKeys: function () {
        for each (gname in this._keyboard.get_groups()) {
             let group = this._keyboard.get_group(gname);
             group.connect('notify::active-level', Lang.bind(this, this._onLevelChanged));
             let layers = {};
             for each (lname in group.get_levels()) {
                 let level = group.get_level(lname);
                 let layout = new St.BoxLayout({ style_class: 'keyboard-layout',
                                                 vertical: 'false' });
                 this._loadRows(level, layout);
                 layers[lname] = layout;
                 this.actor.add(layout);
                 layout.hide();
             }
             this._groups[gname] = layers;
        }
        this._setActiveLayer();
    },

    _addRows : function (keys, layout) {
        let keyboard_row = new St.BoxLayout ({ style_class: 'keyboard-row' });
        let alignEnd = false;
        for each (key in keys) {
            let button = new Key(key);
            keyboard_row.add(button.actor);
            if (key.name == 'Return')
                alignEnd = true;
            if (key.name == "Caribou_Prefs")
                key.connect('key-clicked', Lang.bind(this, this._onPrefsClick));
        }
        if (alignEnd) {
            layout.add(keyboard_row, { x_align: St.Align.END, x_fill: false });
        } else {
            layout.add(keyboard_row, { x_align: St.Align.START, x_fill: false });
        }
    },

    _onPrefsClick: function () {
        let source = new KeyboardSource(this);
        Main.messageTray.add(source);
        this.hide();
        Main.overview.relayout();
    },

    _loadRows : function (level, layout) {
        let rows = level.get_rows();
        for each (row in rows) {
            this._addRows(row.get_keys(),layout);
        }

    },

    _onLevelChanged: function () {
        this._setActiveLayer();
    },

    _onGroupChanged: function () {
        this._setActiveLayer();
    },

    _setActiveLayer: function () {
        let active_group_name = this._keyboard.active_group;
        let active_group = this._keyboard.get_group(active_group_name);
        let active_level = active_group.active_level;
        let layers = this._groups[active_group_name];

        if (this._current_page != null) {
            this._current_page.hide();
        }

        this._current_page = layers[active_level];
        layers[active_level].show();
    },

    show: function () {
        this.actor.show();
        this._current_page.show();
        this.showKeyboard = true;
    },

    hide: function () {
        let active_group_name = this._keyboard.active_group;
        let group = this._keyboard.get_group(active_group_name);
        let layers = this._groups[active_group_name];
        for each (lname in group.get_levels()) {
            layers[lname].hide();
        }
        this.actor.hide();
        this.showKeyboard = false;
    }
};

function KeyboardSource() {
    this._init.apply(this, arguments);
}

KeyboardSource.prototype = {
    __proto__: MessageTray.Source.prototype,

    _init: function(keyboard) {
        this._keyboard = keyboard;
        MessageTray.Source.prototype._init.call(this, _("Keyboard"));

        this._setSummaryIcon(this.createNotificationIcon());
    },

    createNotificationIcon: function() {
        return new St.Icon({ icon_name: 'input-keyboard',
                             icon_type: St.IconType.SYMBOLIC,
                             icon_size: this.ICON_SIZE });
    },

     handleSummaryClick: function() {
        let event = Clutter.get_current_event();
        if (event.type() != Clutter.EventType.BUTTON_RELEASE)
            return false;

        if (event.get_button() != 1)
            return false;

        this.open();
        return true;
    },

    open: function() {
        this._keyboard.show();
        Main.overview.relayout();
        this.destroy();
    }
};
