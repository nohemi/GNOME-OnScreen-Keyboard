/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

const Caribou = imports.gi.Caribou;
const Clutter = imports.gi.Clutter;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const BoxPointer = imports.ui.boxpointer;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const PopupMenu = imports.ui.popupMenu;

const KEYBOARD_SCHEMA = 'org.gnome.shell.keyboard';
const SHOW_KEYBOARD = 'show-keyboard';
const ENABLE_DRAGGABLE = 'enable-drag';
// Key constants taken from Antler
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
    _init : function(key, key_width, key_height) {
        this._key = key;

        this._width = key_width;
        this._height = key_height;

        this.actor = this._getKey();

        this._extended_keys = this._key.get_extended_keys();
        this._extended_keyboard = {};

        if (this._extended_keys.length > 0) {
            this._grabbed = false;
            this._eventCaptureId = 0;
            this._key.connect('notify::show-subkeys', Lang.bind(this, this._onShowSubkeysChanged));
            this._boxPointer = new BoxPointer.BoxPointer(St.Side.BOTTOM,
                                                   { x_fill: true,
                                                     y_fill: true,
                                                     x_align: St.Align.START });
            // Adds style to existing keyboard style to avoid repetition
            this._boxPointer.actor.add_style_class_name('keyboard-subkeys');
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

            for (let i = 0; i < PRETTY_KEYS.length; ++i) {
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
        for (let i = 0; i < this._extended_keys.length; ++i) {
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

    _onShowSubkeysChanged: function () {
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

        // Initialize keyboard key measurements
        this._numOfHorizKeys = 0;
        this._numOfVertKeys = 0;
        this._horizontalSpacing = 15;
        this._verticalSpacing = 10;
        this._padding = 10;

        this._keyboardSettings = new Gio.Settings({ schema: KEYBOARD_SCHEMA });
        this._keyboardSettings.connect('changed', Lang.bind(this, this._onSettingsChanged));
        this._draggable = this._keyboardSettings.get_boolean(ENABLE_DRAGGABLE);
        this._addKeys();

        this._keyboard.connect('notify::active-group', Lang.bind(this, this._onGroupChanged));
        Main.layoutManager.connect('monitors-changed', Lang.bind(this, this._reposition));
        this.actor.connect('allocation-changed', Lang.bind(this, this._queueReposition));
        if (this._draggable) {
            Main.chrome.addActor(this.actor, { visibleInOverview: true,
                                               visibleInFullscreen: true,
                                               affectsStruts: false });
        } else {
            Main.chrome.addActor(this.actor, { visibleInOverview: true,
                                               visibleInFullscreen: true,
                                               affectsStruts: true });
        }
        this._reposition();
        this._display();
    },

    _display: function () {
        let showKeyboard = this._keyboardSettings.get_boolean(SHOW_KEYBOARD);
        if (showKeyboard) {
            this.show();
        } else {
            this.hide();
        }
    },

    _onSettingsChanged: function () {
        this._display();
        Main.overview.relayout();
    },

    _onStyleChanged: function (actor) {
        if (actor.get_style_class_name() == 'keyboard-row')
            this._horizontalSpacing = actor.get_theme_node().get_length('spacing');
        if (actor.get_style_class_name() == 'keyboard-layout')
            this._verticalSpacing = actor.get_theme_node().get_length('spacing');
            this._padding = actor.padding
    },

    _reposition: function () {
        let primary = Main.layoutManager.primaryMonitor;
        this.actor.x = primary.x;
        this.actor.y = primary.y + primary.height - this.actor.height;
        this.actor.height = primary.height / 3;
    },

    _queueReposition: function () {
        Meta.later_add(Meta.LaterType.BEFORE_REDRAW, Lang.bind(this, function () { this._reposition(); }));
    },

    _addKeys: function () {
        for (let i = 0; i < this._keyboard.get_groups().length; ++i) {
             let gname = this._keyboard.get_groups()[i];
             let group = this._keyboard.get_group(gname);
             group.connect('notify::active-level', Lang.bind(this, this._onLevelChanged));
             let layers = {};
             for (let j = 0; j < group.get_levels().length; ++j) {
                 let lname = group.get_levels()[j];
                 let level = group.get_level(lname);
                 let layout = new St.BoxLayout({ style_class: 'keyboard-layout',
                                                 vertical: 'false' });
                 this._loadRows(level, layout);
                 layers[lname] = layout;
                 this.actor.add(layout);

                 // Set layout spacing
                 if (this._verticalSpacing == 0) {
                     layout.spacing = 0;
                     layout.connect('style-changed', Lang.bind(this, this._onStyleChanged));
                 }

                 layout.hide();
             }
             this._groups[gname] = layers;
        }
        this._setActiveLayer();
    },

    _addRows : function (keys, layout) {
        let keyboard_row = new St.BoxLayout ({ style_class: 'keyboard-row' });
        let alignEnd = false;
        let primary_monitor = Main.layoutManager.primaryMonitor;
        for (let i = 0; i < keys.length; ++i) {
            if (this._numOfHorizKeys == 0)
                this._numOfHorizKeys = keys.length;
            let key = keys[i];
            let key_width = (primary_monitor.width - (this._numOfHorizKeys - 1) * this._horizontalSpacing
                             - 2 * this._padding)/ this._numOfHorizKeys * key.width;
            let key_height = (primary_monitor.height / 3 - (this._numOfVertKeys - 1) * this._verticalSpacing
                              - 2 * this._padding) / this._numOfVertKeys;
            if (this._draggable)
                key_width = key_height * key.width;
            let button = new Key(key, key_width, key_height);
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
    },

    _loadRows : function (level, layout) {
        let rows = level.get_rows();
        for (let i = 0; i < rows.length; ++i) {
            let row = rows[i];
            if (this._numOfVertKeys == 0)
                this._numOfVertKeys = rows.length;
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
        this.actor.hide();
        this._current_page.hide();
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
        this.destroy();
    }
};
