/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Signals = imports.signals;
const St = imports.gi.St;

const Main = imports.ui.main;
const Panel = imports.ui.panel;
const Tweener = imports.ui.tweener;

const State = {
    HIDDEN:  0,
    SHOWING: 1,
    SHOWN:   2,
    HIDING:  3
};

function LayoutManager() {
    this._init.apply(this, arguments);
}

LayoutManager.prototype = {
    _init: function () {
        this._rtl = (St.Widget.get_default_direction() == St.TextDirection.RTL);
        this.monitors = [];
        this.primaryMonitor = null;
        this.primaryIndex = -1;
        this._hotCorners = [];
        this.bottomBox = new Clutter.Group();
        this.topBox = new Clutter.Group({ clip_to_allocation: true });
        this.bottomBox.add_actor(this.topBox);

        global.screen.connect('monitors-changed', Lang.bind(this, this._monitorsChanged));
        this._updateMonitors();

        Main.connect('layout-initialized', Lang.bind(this, this._initChrome));

        Main.connect('main-ui-initialized', Lang.bind(this, this._finishInit));
    },

    _initChrome: function() {
        Main.chrome.addActor(this.bottomBox, { affectsStruts: false,
                                               visibleInFullscreen: true });
    },

    // _updateHotCorners needs access to Main.panel
    _finishInit: function() {
        this._updateHotCorners();

        this.topBox.height = Main.messageTray.actor.height;
        this.topBox.y = - Main.messageTray.actor.height;

        this._keyboardState = Main.keyboard.actor.visible ? State.SHOWN : State.HIDDEN;
        this._traySummoned = true;

        Main.keyboard.actor.connect('allocation-changed', Lang.bind(this, this._updateForKeyboard));
    },

    _updateForKeyboard: function () {
        if (Tweener.isTweening(this.bottomBox))
            return;

        this.topBox.y = - Main.messageTray.actor.height;
        let bottom = this.bottomMonitor.y + this.bottomMonitor.height;
        if (this._keyboardState == State.SHOWN)
            this.bottomBox.y = bottom - Main.keyboard.actor.height;
        else {
            this.bottomBox.y = bottom;
            this._keyboardState = State.HIDDEN;
        }

    },

    updateForTray: function () {
        if (this._keyboardState == State.SHOWN) {
            if (this._traySummoned) {
                Main.messageTray.lock();
                this._traySummoned = false;
            }
            else {
                Main.messageTray.unlock();
                this._traySummoned = true;
            }
        }
        else {
            Main.messageTray.unlock();
            this._traySummoned = false;
        }
    },

    showKeyboard: function () {
        let bottom = this.bottomMonitor.y + this.bottomMonitor.height;
        // Keyboard height cannot be found directly since the first
        // call to this method may be when Keyboard.Keyboard() has
        // not returned; therefore the keyboard would be null
        Tweener.addTween(this.bottomBox,
                         { y: bottom - this.primaryMonitor.height / 3,
                           time: 0.5,
                           transition: 'easeOutQuad',
                         });
        this._keyboardState = State.SHOWN;
        this.updateForTray();
    },

    hideKeyboard: function () {
        let bottom = this.bottomMonitor.y + this.bottomMonitor.height;
        Tweener.addTween(this.bottomBox,
                         { y: bottom,
                           time: 0.5,
                           transition: 'easeOutQuad'
                         });
        this._keyboardState = State.HIDDEN;
        this.updateForTray();
    },

    _updateMonitors: function() {
        let screen = global.screen;

        this.monitors = [];
        let nMonitors = screen.get_n_monitors();
        for (let i = 0; i < nMonitors; i++)
            this.monitors.push(screen.get_monitor_geometry(i));

        if (nMonitors == 1) {
            this.primaryIndex = this.bottomIndex = 0;
        } else {
            // If there are monitors below the primary, then we need
            // to split primary from bottom.
            this.primaryIndex = this.bottomIndex = screen.get_primary_monitor();
            for (let i = 0; i < this.monitors.length; i++) {
                let monitor = this.monitors[i];
                if (this._isAboveOrBelowPrimary(monitor)) {
                    if (monitor.y > this.monitors[this.bottomIndex].y)
                        this.bottomIndex = i;
                }
            }
        }
        this.primaryMonitor = this.monitors[this.primaryIndex];
        this.bottomMonitor = this.monitors[this.bottomIndex];

        this.bottomBox.set_position(0, this.bottomMonitor.y + this.bottomMonitor.height);
        this.bottomBox.width = this.bottomMonitor.width;
    },

    _updateHotCorners: function() {
        // destroy old hot corners
        for (let i = 0; i < this._hotCorners.length; i++)
            this._hotCorners[i].destroy();
        this._hotCorners = [];

        // build new hot corners
        for (let i = 0; i < this.monitors.length; i++) {
            let monitor = this.monitors[i];
            let cornerX = this._rtl ? monitor.x + monitor.width : monitor.x;
            let cornerY = monitor.y;

            let haveTopLeftCorner = true;

            if (i != this.primaryIndex) {
                // Check if we have a top left (right for RTL) corner.
                // I.e. if there is no monitor directly above or to the left(right)
                let besideX = this._rtl ? monitor.x + 1 : cornerX - 1;
                let besideY = cornerY;
                let aboveX = cornerX;
                let aboveY = cornerY - 1;

                for (let j = 0; j < this.monitors.length; j++) {
                    if (i == j)
                        continue;
                    let otherMonitor = this.monitors[j];
                    if (besideX >= otherMonitor.x &&
                        besideX < otherMonitor.x + otherMonitor.width &&
                        besideY >= otherMonitor.y &&
                        besideY < otherMonitor.y + otherMonitor.height) {
                        haveTopLeftCorner = false;
                        break;
                    }
                    if (aboveX >= otherMonitor.x &&
                        aboveX < otherMonitor.x + otherMonitor.width &&
                        aboveY >= otherMonitor.y &&
                        aboveY < otherMonitor.y + otherMonitor.height) {
                        haveTopLeftCorner = false;
                        break;
                    }
                }
            }

            if (!haveTopLeftCorner)
                continue;

            let corner = new Panel.HotCorner(i == this.primaryIndex ? Main.panel.button : null);
            this._hotCorners.push(corner);
            corner.actor.set_position(cornerX, cornerY);
            if (i == this.primaryIndex)
                Main.panel.setHotCorner(corner);
        }
    },

    _monitorsChanged: function() {
        this._updateMonitors();
        this._updateHotCorners();

        this.emit('monitors-changed');
    },

    _isAboveOrBelowPrimary: function(monitor) {
        let primary = this.monitors[this.primaryIndex];
        let monitorLeft = monitor.x, monitorRight = monitor.x + monitor.width;
        let primaryLeft = primary.x, primaryRight = primary.x + primary.width;

        if ((monitorLeft >= primaryLeft && monitorLeft <= primaryRight) ||
            (monitorRight >= primaryLeft && monitorRight <= primaryRight) ||
            (primaryLeft >= monitorLeft && primaryLeft <= monitorRight) ||
            (primaryRight >= monitorLeft && primaryRight <= monitorRight))
            return true;

        return false;
    },

    get focusIndex() {
        let screen = global.screen;
        let display = screen.get_display();
        let focusWindow = display.focus_window;

        if (focusWindow) {
            let wrect = focusWindow.get_outer_rect();
            for (let i = 0; i < this.monitors.length; i++) {
                let monitor = this.monitors[i];

                if (monitor.x <= wrect.x && monitor.y <= wrect.y &&
                    monitor.x + monitor.width > wrect.x &&
                    monitor.y + monitor.height > wrect.y)
                    return i;
            }
        }

        return this.primaryIndex;
    },

    get focusMonitor() {
        return this.monitors[this.focusIndex];
    }
};
Signals.addSignalMethods(LayoutManager.prototype);
