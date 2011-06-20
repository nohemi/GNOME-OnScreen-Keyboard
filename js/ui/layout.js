/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

const Lang = imports.lang;
const Meta = imports.gi.Meta;
const Signals = imports.signals;
const St = imports.gi.St;

const Main = imports.ui.main;
const Panel = imports.ui.panel;

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

        this._updateMonitors();

        // in case someone looks at these before they've been computed;
        // we'll emit 'content-area-changed' when they're correct
        this.primaryContentArea = this.overviewContentArea = this.primaryMonitor;
    },

    init: function() {
        this._panelHeight = Main.panel.actor.height;
        this._trayHeight = Main.messageTray.actor.height;
        this._keyboardHeight = Main.keyboard.actor.height;

        global.screen.connect('monitors-changed', Lang.bind(this, this._monitorsChanged));
        this._updateHotCorners();

        Main.panel.actor.connect('allocation-changed', Lang.bind(this, this._allocationChanged));
        Main.messageTray.actor.connect('allocation-changed', Lang.bind(this, this._allocationChanged));
        Main.keyboard.actor.connect('allocation-changed', Lang.bind(this, this._allocationChanged));
        Main.keyboard.actor.connect('notify::visible', Lang.bind(this, this._visibilityChanged));
        this._updateContentArea();
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
            // If there are monitors above the primary, then we need
            // to redeclare the topmost monitor to be the primary.
            // Likewise, if there are monitors below it, we need to
            // split primary from bottom.

            this.primaryIndex = this.bottomIndex = screen.get_primary_monitor();
            for (let i = 0; i < this.monitors.length; i++) {
                let monitor = this.monitors[i];
                if (this._isAboveOrBelowPrimary(monitor)) {
                    if (monitor.y < this.monitors[this.primaryIndex].y)
                        this.primaryIndex = i;
                    else if (monitor.y > this.monitors[this.bottomIndex].y)
                        this.bottomIndex = i;
                }
            }
        }
        this.primaryMonitor = this.monitors[this.primaryIndex];
        this.bottomMonitor = this.monitors[this.bottomIndex];
    },

    _updateContentArea: function() {
        let changed = false;

        let primaryContentArea = new Meta.Rectangle(this.primaryMonitor);
        primaryContentArea.y += this._panelHeight;
        primaryContentArea.height -= this._panelHeight;
        if (!this.primaryContentArea.equal(primaryContentArea)) {
            this.primaryContentArea = primaryContentArea;
            changed = true;
        }

        let overviewContentArea = new Meta.Rectangle(this.primaryContentArea);
        overviewContentArea.height -= this._trayHeight;
        if (!this.overviewContentArea.equal(overviewContentArea)) {
            this.overviewContentArea = overviewContentArea;
            changed = true;
        }

        if (changed) {
            this.emit('content-area-changed');
            this.emit('monitors-changed'); // FIXME
        }
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
        this._updateContentArea();

        this.emit('monitors-changed');
    },

    _allocationChanged: function(actor, box, flags) {
        let height = box.y2 - box.y1;

        if (actor == Main.panel.actor)
            this._panelHeight = height;
        else if (actor == Main.messageTray.actor)
            this._trayHeight = height;
        else if (actor == Main.keyboard.actor && Main.keyboard.actor.visible)
            this._keyboardHeight = height;

        this._updateContentArea();
    },

    _visibilityChanged: function(actor) {
        if (Main.keyboard.actor.visible)
            this._keyboardHeight = Main.keyboard.actor.height;
        else
            this._keyboardHeight = 0;

        this._updateContentArea();
    },

    _isAboveOrBelowPrimary: function(monitor) {
        let primary = this.monitors[this.primaryIndex];

        if (this._rtl) {
            if (monitor.x + monitor.width == primary.x + primary.width)
                return true;
        } else {
            if (monitor.x == primary.x)
                return true;
        }

        if (monitor.x <= primary.x &&
            (monitor.x + monitor.width) >= (primary.x + primary.width))
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