/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

const Clutter = imports.gi.Clutter;
const DBus = imports.dbus;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const Telepathy = imports.misc.telepathy;

let avatarManager;
let channelDispatcher;

// See Notification.appendMessage
const SCROLLBACK_RECENT_TIME = 15 * 60; // 15 minutes
const SCROLLBACK_RECENT_LENGTH = 20;
const SCROLLBACK_IDLE_LENGTH = 5;

// This is GNOME Shell's implementation of the Telepathy "Client"
// interface. Specifically, the shell is a Telepathy "Observer", which
// lets us see messages even if they belong to another app (eg,
// Empathy).

function Client() {
    this._init();
};

Client.prototype = {
    _init : function() {
        let name = Telepathy.CLIENT_NAME + '.GnomeShell';
        DBus.session.exportObject(Telepathy.nameToPath(name), this);
        DBus.session.acquire_name(name, DBus.SINGLE_INSTANCE,
                                  function (name) { /* FIXME: acquired */ },
                                  function (name) { /* FIXME: lost */ });

        this._channels = {};

        avatarManager = new AvatarManager();

        channelDispatcher = new Telepathy.ChannelDispatcher(DBus.session,
                                                            Telepathy.CHANNEL_DISPATCHER_NAME,
                                                            Telepathy.nameToPath(Telepathy.CHANNEL_DISPATCHER_NAME));

        // Acquire existing connections. (Needed to make things work
        // through a restart.)
        let accountManager = new Telepathy.AccountManager(DBus.session,
                                                          Telepathy.ACCOUNT_MANAGER_NAME,
                                                          Telepathy.nameToPath(Telepathy.ACCOUNT_MANAGER_NAME));
        accountManager.GetRemote('ValidAccounts', Lang.bind(this, this._gotValidAccounts));
    },

    _gotValidAccounts: function(accounts, err) {
        if (!accounts)
            return;

        for (let i = 0; i < accounts.length; i++) {
            let account = new Telepathy.Account(DBus.session,
                                                Telepathy.ACCOUNT_MANAGER_NAME,
                                                accounts[i]);
            account.GetRemote('Connection', Lang.bind(this,
                function (connPath, err) {
                    if (!connPath || connPath == '/')
                        return;

                    let connReq = new Telepathy.ConnectionRequests(DBus.session,
                                                                   Telepathy.pathToName(connPath),
                                                                   connPath);
                    connReq.GetRemote('Channels', Lang.bind(this,
                        function(channels, err) {
                            if (!channels)
                                return;
                            this._addChannels(account.getPath(), connPath, channels);
                        }));
                }));
        }
    },

    get Interfaces() {
        return [ Telepathy.CLIENT_OBSERVER_NAME ];
    },

    get ObserverChannelFilter() {
        return [
            // We only care about single-user text-based chats
            { 'org.freedesktop.Telepathy.Channel.ChannelType': Telepathy.CHANNEL_TEXT_NAME,
              'org.freedesktop.Telepathy.Channel.TargetHandleType': Telepathy.HandleType.CONTACT },

            // Some protocols only support "multi-user" chats, and
            // single-user chats are just treated as multi-user chats
            // with only one other participant. Telepathy uses
            // HandleType.NONE for all chats in these protocols;
            // there's no good way for us to tell if the channel is
            // single- or multi-user.
            { 'org.freedesktop.Telepathy.Channel.ChannelType': Telepathy.CHANNEL_TEXT_NAME,
              'org.freedesktop.Telepathy.Channel.TargetHandleType': Telepathy.HandleType.NONE }
        ];
    },

    ObserveChannels: function(accountPath, connPath, channels,
                              dispatchOperation, requestsSatisfied,
                              observerInfo) {
        this._addChannels(accountPath, connPath, channels);
    },

    _addChannels: function(accountPath, connPath, channelDetailsList) {
        for (let i = 0; i < channelDetailsList.length; i++) {
            let [channelPath, props] = channelDetailsList[i];
            if (this._channels[channelPath])
                continue;

            // If this is being called from the startup code then it
            // won't have passed through our filters, so we need to
            // check the channel/targetHandle type ourselves.

            let channelType = props[Telepathy.CHANNEL_NAME + '.ChannelType'];
            if (channelType != Telepathy.CHANNEL_TEXT_NAME)
                continue;

            let targetHandleType = props[Telepathy.CHANNEL_NAME + '.TargetHandleType'];
            if (targetHandleType != Telepathy.HandleType.CONTACT &&
                targetHandleType != Telepathy.HandleType.NONE)
                continue;

            let targetHandle = props[Telepathy.CHANNEL_NAME + '.TargetHandle'];
            let targetId = props[Telepathy.CHANNEL_NAME + '.TargetID'];

            let source = new Source(accountPath, connPath, channelPath,
                                    targetHandle, targetHandleType, targetId);
            this._channels[channelPath] = source;
            source.connect('destroy', Lang.bind(this,
                function() {
                    delete this._channels[channelPath];
                }));
        }
    }
};
DBus.conformExport(Client.prototype, Telepathy.ClientIface);
DBus.conformExport(Client.prototype, Telepathy.ClientObserverIface);


function AvatarManager() {
    this._init();
};

AvatarManager.prototype = {
    _init: function() {
        this._connections = {};
        // Note that if we changed this to '/telepathy/avatars' then
        // we would share cache files with empathy. But since this is
        // not documented/guaranteed, it seems a little sketchy
        this._cacheDir = GLib.get_user_cache_dir() + '/gnome-shell/avatars';
    },

    _addConnection: function(conn) {
        let info = {};

        // Figure out the cache subdirectory for this connection by
        // parsing the connection manager name (eg, 'gabble') and
        // protocol name (eg, 'jabber') from the Connection's path.
        // Telepathy requires the D-Bus path for a connection to have
        // a specific form, and explicitly says that clients are
        // allowed to parse it.
        let match = conn.getPath().match(/\/org\/freedesktop\/Telepathy\/Connection\/([^\/]*\/[^\/]*)\/.*/);
        if (!match)
            throw new Error('Could not parse connection path ' + conn.getPath());

        info.cacheDir = this._cacheDir + '/' + match[1];
        GLib.mkdir_with_parents(info.cacheDir, 0700);

        // info.token[handle] is the token for @handle's avatar
        info.token = {};

        // info.icons[handle] is an array of the icon actors currently
        // being displayed for @handle. These will be updated
        // automatically if @handle's avatar changes.
        info.icons = {};

        info.connectionAvatars = new Telepathy.ConnectionAvatars(DBus.session,
                                                                 conn.getBusName(),
                                                                 conn.getPath());
        info.updatedId = info.connectionAvatars.connect(
            'AvatarUpdated', Lang.bind(this, this._avatarUpdated));
        info.retrievedId = info.connectionAvatars.connect(
            'AvatarRetrieved', Lang.bind(this, this._avatarRetrieved));

        info.statusChangedId = conn.connect('StatusChanged', Lang.bind(this,
            function (status, reason) {
                if (status == Telepathy.ConnectionStatus.DISCONNECTED)
                    this._removeConnection(conn);
            }));

        this._connections[conn.getPath()] = info;
        return info;
    },

    _removeConnection: function(conn) {
        let info = this._connections[conn.getPath()];
        if (!info)
            return;

        conn.disconnect(info.statusChangedId);
        info.connectionAvatars.disconnect(info.updatedId);
        info.connectionAvatars.disconnect(info.retrievedId);

        delete this._connections[conn.getPath()];
    },

    _getFileForToken: function(info, token) {
        return info.cacheDir + '/' + Telepathy.escapeAsIdentifier(token);
    },

    _setIcon: function(iconBox, info, handle) {
        let textureCache = St.TextureCache.get_default();
        let token = info.token[handle];
        let file;

        if (token) {
            file = this._getFileForToken(info, token);
            if (!GLib.file_test(file, GLib.FileTest.EXISTS))
                file = null;
        }

        if (file) {
            let uri = GLib.filename_to_uri(file, null);
            iconBox.child = textureCache.load_uri_async(uri, iconBox._size, iconBox._size);
        } else {
            iconBox.child = textureCache.load_icon_name('stock_person', iconBox._size);
        }
    },

    _updateIcons: function(info, handle) {
        if (!info.icons[handle])
            return;

        for (let i = 0; i < info.icons[handle].length; i++) {
            let iconBox = info.icons[handle][i];
            this._setIcon(iconBox, info, handle);
        }
    },

    _avatarUpdated: function(conn, handle, token) {
        let info = this._connections[conn.getPath()];
        if (!info)
            return;

        if (info.token[handle] == token)
            return;

        info.token[handle] = token;
        if (token != '') {
            let file = this._getFileForToken(info, token);
            if (!GLib.file_test(file, GLib.FileTest.EXISTS)) {
                info.connectionAvatars.RequestAvatarsRemote([handle]);
                return;
            }
        }

        this._updateIcons(info, handle);
    },

    _avatarRetrieved: function(conn, handle, token, avatarData, mimeType) {
        let info = this._connections[conn.getPath()];
        if (!info)
            return;

        let file = this._getFileForToken(info, token);
        let success = false;
        try {
            success = GLib.file_set_contents(file, avatarData, avatarData.length);
        } catch (e) {
            logError(e, 'Error caching avatar data');
        }

        if (success)
            this._updateIcons(info, handle);
    },

    createAvatar: function(conn, handle, size) {
        let iconBox = new St.Bin({ style_class: 'avatar-box' });
        iconBox._size = size;

        let info = this._connections[conn.getPath()];
        if (!info)
            info = this._addConnection(conn);

        if (!info.icons[handle])
            info.icons[handle] = [];
        info.icons[handle].push(iconBox);

        iconBox.connect('destroy', Lang.bind(this,
            function() {
                let i = info.icons[handle].indexOf(iconBox);
                if (i != -1)
                    info.icons[handle].splice(i, 1);
            }));

        // If we already have the icon cached and know its token, this
        // will fill it in. Otherwise it will fill in the default
        // icon.
        this._setIcon(iconBox, info, handle);

        // Asynchronously load the real avatar if we don't have it yet.
        if (info.token[handle] == null) {
            info.connectionAvatars.GetKnownAvatarTokensRemote([handle], Lang.bind(this,
                function (tokens, err) {
                    let token = tokens && tokens[handle] ? tokens[handle] : '';
                    this._avatarUpdated(conn, handle, token);
                }));
        }

        return iconBox;
    }
};


function Source(accountPath, connPath, channelPath, targetHandle, targetHandleType, targetId) {
    this._init(accountPath, connPath, channelPath, targetHandle, targetHandleType, targetId);
}

Source.prototype = {
    __proto__:  MessageTray.Source.prototype,

    _init: function(accountPath, connPath, channelPath, targetHandle, targetHandleType, targetId) {
        MessageTray.Source.prototype._init.call(this, targetId);

        this._accountPath = accountPath;

        let connName = Telepathy.pathToName(connPath);
        this._conn = new Telepathy.Connection(DBus.session, connName, connPath);
        this._channel = new Telepathy.Channel(DBus.session, connName, channelPath);
        this._closedId = this._channel.connect('Closed', Lang.bind(this, this._channelClosed));

        this._targetHandle = targetHandle;
        this._targetHandleType = targetHandleType;
        this._targetId = targetId;

        this.name = this._targetId;
        if (targetHandleType == Telepathy.HandleType.CONTACT) {
            let aliasing = new Telepathy.ConnectionAliasing(DBus.session, connName, connPath);
            aliasing.RequestAliasesRemote([this._targetHandle], Lang.bind(this,
                function (aliases, err) {
                    if (aliases && aliases.length)
                        this.name = aliases[0];
                }));
        }

        this._channelText = new Telepathy.ChannelText(DBus.session, connName, channelPath);
        this._receivedId = this._channelText.connect('Received', Lang.bind(this, this._messageReceived));

        this._channelText.ListPendingMessagesRemote(false, Lang.bind(this, this._gotPendingMessages));
    },

    createIcon: function(size) {
        return avatarManager.createAvatar(this._conn, this._targetHandle, size);
    },

    clicked: function() {
        channelDispatcher.EnsureChannelRemote(this._accountPath,
                                              { 'org.freedesktop.Telepathy.Channel.ChannelType': Telepathy.CHANNEL_TEXT_NAME,
                                                'org.freedesktop.Telepathy.Channel.TargetHandle': this._targetHandle,
                                                'org.freedesktop.Telepathy.Channel.TargetHandleType': this._targetHandleType },
                                              global.get_current_time(),
                                              '',
                                              Lang.bind(this, this._gotChannelRequest));

        MessageTray.Source.prototype.clicked.call(this);
    },

    _gotChannelRequest: function (chanReqPath, ex) {
        if (ex) {
            log ('EnsureChannelRemote failed? ' + ex);
            return;
        }

        let chanReq = new Telepathy.ChannelRequest(DBus.session, Telepathy.CHANNEL_DISPATCHER_NAME, chanReqPath);
        chanReq.ProceedRemote();
    },

    _gotPendingMessages: function(msgs, err) {
        if (!msgs)
            return;

        for (let i = 0; i < msgs.length; i++)
            this._messageReceived.apply(this, [this._channel].concat(msgs[i]));
    },

    _channelClosed: function() {
        this._channel.disconnect(this._closedId);
        this._channelText.disconnect(this._receivedId);
        this.destroy();
    },

    _messageReceived: function(channel, id, timestamp, sender,
                               type, flags, text) {
        if (!Main.messageTray.contains(this))
            Main.messageTray.add(this);

        if (!this._notification)
            this._notification = new Notification(this._targetId, this);
        this._notification.appendMessage(text);
        this.notify(this._notification);
    },

    respond: function(text) {
        this._channelText.SendRemote(Telepathy.ChannelTextMessageType.NORMAL, text);
    }
};

function Notification(id, source) {
    this._init(id, source);
}

Notification.prototype = {
    __proto__:  MessageTray.Notification.prototype,

    _init: function(id, source) {
        MessageTray.Notification.prototype._init.call(this, id, source, source.name);
        this.actor.connect('button-press-event', Lang.bind(this, this._onButtonPress));

        this._responseEntry = new St.Entry({ style_class: 'chat-response' });
        this._responseEntry.clutter_text.connect('key-focus-in', Lang.bind(this, this._onEntryFocused));
        this._responseEntry.clutter_text.connect('activate', Lang.bind(this, this._onEntryActivated));
        this.setActionArea(this._responseEntry);

        this._history = [];
    },

    appendMessage: function(text) {
        this.update(this.source.name, text);
        this._append(text, 'chat-received');
    },

    _append: function(text, style) {
        let body = this.addBody(text);
        body.add_style_class_name(style);
        this.scrollTo(St.Side.BOTTOM);

        let now = new Date().getTime() / 1000;
        this._history.unshift({ actor: body, time: now });

        if (this._history.length > 1) {
            // Keep the scrollback from growing too long. If the most
            // recent message (before the one we just added) is within
            // SCROLLBACK_RECENT_TIME, we will keep
            // SCROLLBACK_RECENT_LENGTH previous messages. Otherwise
            // we'll keep SCROLLBACK_IDLE_LENGTH messages.

            let lastMessageTime = this._history[1].time;
            let maxLength = (lastMessageTime < now - SCROLLBACK_RECENT_TIME) ?
                SCROLLBACK_IDLE_LENGTH : SCROLLBACK_RECENT_LENGTH;
            if (this._history.length > maxLength) {
                let expired = this._history.splice(maxLength);
                for (let i = 0; i < expired.length; i++)
                    expired[i].actor.destroy();
            }
        }
    },

    _onButtonPress: function(notification, event) {
        if (!this._active)
            return false;

        let source = event.get_source ();
        while (source) {
            if (source == notification)
                return false;
            source = source.get_parent();
        }

        // @source is outside @notification, which has to mean that
        // we have a pointer grab, and the user clicked outside the
        // notification, so we should deactivate.
        this._deactivate();
        return true;
    },

    _onEntryFocused: function() {
        if (this._active)
            return;

        if (!Main.pushModal(this.actor))
            return;
        Clutter.grab_pointer(this.actor);

        this._active = true;
        Main.messageTray.lock();
    },

    _onEntryActivated: function() {
        let text = this._responseEntry.get_text();
        if (text == '') {
            this._deactivate();
            return;
        }

        this._responseEntry.set_text('');
        this._append(text, 'chat-sent');
        this.source.respond(text);
    },

    _deactivate: function() {
        if (this._active) {
            Clutter.ungrab_pointer(this.actor);
            Main.popModal(this.actor);
            global.stage.set_key_focus(null);

            // We have to do this after calling popModal(), because
            // that will return the keyboard focus to
            // this._responseEntry (because that's where it was when
            // pushModal() was called), which will cause
            // _onEntryFocused() to be called again, but we don't want
            // it to do anything.
            this._active = false;

            Main.messageTray.unlock();
        }
    }
};