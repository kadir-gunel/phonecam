// SPDX-License-Identifier: GPL-3.0-or-later
// The widget of PhoneCam: the row in the system menu, the menu, the wheel, and
// the keyboard shortcut.
//
// The widget shows the state and it sends commands to the engine. The engine
// (bin/phonecam of this repository) does all the work, so the state is also
// correct when the stream starts from a terminal.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

import {
    nextRotationArgv, previewArgv, previousRotationArgv, timeoutFor,
} from './cli.js';
import {PhoneCamService, SETTLING_SECONDS} from './service.js';
import {planMenu} from './state.js';

/* The icon is a telephone. The theme draws `camera-web-symbolic` and
   `camera-video-symbolic` with equal pixels, and GNOME Shell shows
   `camera-web-symbolic` in the panel while an application uses a camera. Thus
   a camera icon for this widget would look like the indicator of GNOME. */
const PANEL_ICON_NAME = 'phone-symbolic';
const KEYBINDING_NAME = 'toggle-shortcut';
const SHOW_PANEL_ICON_KEY = 'show-panel-icon';
const SETUP_TIMEOUT_SECONDS = 60;
/* The light of the running stream. A screen reader finds it by this name. */
const LIVE_LIGHT_NAME = 'The camera stream runs';

/** One line of text that shortens with "…" when it is too long. */
function labelLine(text, styleClass) {
    const label = new St.Label({text, x_expand: true, style_class: styleClass});
    label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return label;
}

/** One or two lines of text. Not interactive. */
function textItem(title, subtitle, styleClass) {
    const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    if (styleClass)
        item.add_style_class_name(styleClass);

    const box = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'phonecam-row-box'});
    box.add_child(labelLine(title, 'phonecam-row-title'));
    if (subtitle)
        box.add_child(labelLine(subtitle, 'phonecam-row-subtitle'));
    item.add_child(box);
    return item;
}

/** The last line of an output, for a message in the menu. */
function lastLine(text) {
    const lines = String(text ?? '').trim().split('\n').filter(line => line.trim() !== '');
    return lines.length > 0 ? lines[lines.length - 1] : '';
}

/** The small green light of the running stream. */
function liveLight() {
    const light = new St.Widget({
        style_class: 'phonecam-live-light',
        visible: false,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.END,
    });
    light.accessible_name = LIVE_LIGHT_NAME;
    return light;
}

/** The light sits over the lower right corner of an icon, so the two widgets
 *  share one bin layout and the light does not widen the icon. BinLayout
 *  honours the alignment of a child only when that child expands, and it
 *  centers a child that does not expand (see clutter-bin-layout.c). Thus the
 *  light expands, and its alignment puts it in the lower right corner of the
 *  icon. */
function iconBox(icon) {
    const box = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        style_class: 'phonecam-icon-box',
    });
    box.add_child(icon);
    return box;
}

/** Put the light over the icon of the toggle. The toggle holds the icon in a
 *  private box, so the widget puts its own box in place of the icon. */
function lightOverToggle(toggle, light) {
    const contents = toggle.get_child()?.get_first_child();
    const box = contents?.get_child();
    const icon = box?.get_first_child();
    if (!icon)
        return null;

    /* The icon comes out of its box first: a widget cannot have two parents. */
    box.remove_child(icon);
    /* The class of the theme gives the icon its size, in the same way as the
       icon of the panel; the colour rules of the stylesheet name it. */
    icon.add_style_class_name('system-status-icon');
    const holder = iconBox(icon);
    holder.add_child(light);
    box.insert_child_at_index(holder, 0);
    return holder;
}

export const PhoneCamIndicator = GObject.registerClass(
class PhoneCamIndicator extends QuickSettings.SystemIndicator {
    _init(settings, {openPreferences, directory}) {
        super._init();

        this._settings = settings;
        this._openPreferences = openPreferences;
        this._directory = directory;
        this._service = new PhoneCamService();
        this._state = null;
        this._problems = [];
        this._errors = [];
        this._updatedAt = null;
        this._timerId = 0;
        this._settlingUntil = 0;
        this._destroyed = false;
        this._keybinding = null;
        this._setupRunning = false;
        this._renderedKey = null;
        this._indicatorIndex = 0;

        /* The widget is no longer a panel button of its own: it is a row of
           the system menu, and its optional icon sits in the box of that menu.
           See the two rules of this class in stylesheet.css. */
        this.add_style_class_name('phonecam-panel-button');

        this._buildPanel();
        this._buildToggle();

        this._applySettings();
        this._connectSettings();

        St.Settings.get().connectObject('notify::color-scheme', () => this._syncStyle(), this);

        this.menu.actor.add_style_class_name('phonecam-menu');
        this.menu.connectObject('open-state-changed', (_menu, open) => {
            if (open)
                this._onMenuOpen();
        }, this);

        this._syncStyle();
        this._render();
        this._scheduleRefresh();
        this.refresh();
    }

    /** Register the widget with the system menu. The panel shows the icon of
     *  the widget only when the user asks for it. */
    enable() {
        const quickSettings = Main.panel.statusArea.quickSettings;
        quickSettings.addExternalIndicator(this);
        this._indicatorIndex = quickSettings._indicators.get_children().indexOf(this);
        this._syncPanelIcon();
    }

    /** The icon of the panel, with the box that holds the colour class. The
     *  icon is a child of the widget from the start; the widget removes the
     *  whole indicator from the panel when the user turns the icon off. */
    _buildPanel() {
        /* `_addIndicator()` gives the icon the class of the theme, and it keeps
           the visibility of the indicator in step with its children. */
        this._panelIcon = this._addIndicator();
        this._panelIcon.icon_name = PANEL_ICON_NAME;
        this._panelIcon.fallback_icon_name = 'camera-photo-symbolic';   /* not camera-web: see above */

        this.remove_child(this._panelIcon);
        this._panelIconBox = iconBox(this._panelIcon);
        /* A screen reader reads the widget in the panel as the state of the
           stream, as it read the panel button before this change. */
        this.accessible_name = 'PhoneCam';
        this.add_child(this._panelIconBox);
        this._syncIndicatorsVisible();
    }

    /** The row of the system menu: the state, the icon, and the whole menu.
     *  The menu of the row is the menu of the widget. */
    _buildToggle() {
        this._Toggle = new QuickSettings.QuickMenuToggle({
            title: 'PhoneCam',
            iconName: PANEL_ICON_NAME,
            toggleMode: true,
        });
        this._Toggle.add_style_class_name('phonecam-toggle');
        this.quickSettingsItems.push(this._Toggle);

        this._liveLight = liveLight();
        this._toggleIconBox = lightOverToggle(this._Toggle, this._liveLight);

        this._Toggle.connect('clicked', () => this._toggle());
        this._Toggle.connect('scroll-event', (_actor, event) => this._onScroll(event));

        // The rows of the menu live in the menu of the row, so a poll cannot
        // close an open submenu under the pointer of the user.
        this.menu = this._Toggle.menu;
    }

    /** Show or hide the icon of the widget in the panel. */
    _syncPanelIcon() {
        const quickSettings = Main.panel.statusArea.quickSettings;
        if (!quickSettings)
            return;
        const show = this._settings.get_boolean(SHOW_PANEL_ICON_KEY);
        try {
            if (show) {
                if (this.get_parent() === null) {
                    const count = quickSettings._indicators.get_n_children();
                    quickSettings._indicators.insert_child_at_index(
                        this, Math.min(this._indicatorIndex, count));
                }
            } else if (this.get_parent() === quickSettings._indicators) {
                quickSettings._indicators.remove_child(this);
            }
        } catch (error) {
            logError(error, 'PhoneCam: the panel icon');
        }
    }

    /** @returns {string|null} The engine that ships next to the extension. */
    _bundledPath(name) {
        if (this._directory === null || this._directory === undefined)
            return null;
        const file = this._directory.get_child('bin').get_child(name);
        return file.query_exists(null) ? file.get_path() : null;
    }

    /** Read the settings into the service. */
    _applySettings() {
        const configured = this._settings.get_string('engine').trim();
        const engine = configured !== '' ? configured : this._bundledPath('phonecam');
        this._service.setEngine(engine ?? 'phonecam');

        const setup = this._settings.get_string('setup').trim();
        this._service.setSetup(setup !== '' ? setup : (this._bundledPath('phonecam-setup') ?? 'phonecam-setup'));

        this._updateKeybinding();
    }

    _connectSettings() {
        this._settings.connectObject('changed::engine', () => {
            this._applySettings();
            this.refresh();
        }, this);
        this._settings.connectObject('changed::setup', () => this._applySettings(), this);
        this._settings.connectObject('changed::poll-interval', () => this._scheduleRefresh(), this);
        this._settings.connectObject(`changed::${SHOW_PANEL_ICON_KEY}`, () => this._syncPanelIcon(), this);
        // The shortcut lives in this schema, so Main.wm reads the same file.
        this._settings.connectObject(`changed::${KEYBINDING_NAME}`, () => this._updateKeybinding(), this);
    }

    _updateKeybinding() {
        const accel = this._settings.get_strv(KEYBINDING_NAME)[0] ?? '';
        if (this._keybinding !== null) {
            Main.wm.removeKeybinding(KEYBINDING_NAME);
            this._keybinding = null;
        }
        if (accel === '')
            return;
        this._keybinding = accel;
        Main.wm.addKeybinding(KEYBINDING_NAME, this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL, () => this._toggle());
    }

    /** The icon takes the attention colour while the stream runs. */
    _syncStyle() {
        const dark = St.Settings.get().color_scheme !== 'prefer-light';
        for (const widget of [this, this._Toggle, this.menu.actor]) {
            widget.remove_style_class_name(dark ? 'phonecam-light' : 'phonecam-dark');
            widget.add_style_class_name(dark ? 'phonecam-dark' : 'phonecam-light');
        }
    }

    _scheduleRefresh() {
        if (this._destroyed)
            return;
        if (this._timerId !== 0) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
        const settling = Date.now() < this._settlingUntil;
        const seconds = settling ? 1 : this._settings.get_uint('poll-interval');
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, Math.max(1, seconds), () => {
            this._timerId = 0;
            this.refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    /** The row of the system menu shows the state, and the light marks the
     *  running stream. */
    _updatePanel() {
        const running = this._state?.running === true;

        const parts = [running ? 'streaming' : 'stopped'];
        if (this._problems.length > 0)
            parts.push(`${this._problems.length} problem${this._problems.length === 1 ? '' : 's'}`);
        const state = parts.join(', ');

        this._Toggle.subtitle = state;
        this._Toggle.checked = running;
        this._Toggle.accessible_name = `PhoneCam: ${state}`;
        this.accessible_name = `PhoneCam: ${state}`;
        this._liveLight.visible = running;

        for (const box of [this._panelIconBox, this._toggleIconBox]) {
            if (!box)
                continue;
            if (running)
                box.add_style_class_name('phonecam-live');
            else
                box.remove_style_class_name('phonecam-live');
        }
    }

    /** Read the state of the engine and the state of the phone. */
    async refresh() {
        if (this._destroyed)
            return;
        const result = await this._service.read();
        if (this._destroyed)
            return;

        this._state = result.state;
        this._problems = result.problems;
        this._phone = result.phone;
        this._device = result.device;
        this._pipeWireSource = result.pipeWireSource;
        this._updatedAt = new Date();
        this._updatePanel();
        this._render();
        this._scheduleRefresh();
    }

    /** Build the menu from the plan. An identical menu stays as it is, so a
     *  poll cannot close an open submenu under the pointer of the user. */
    _render() {
        const plan = planMenu(this._state ?? {
            running: false, rotation: '0', camera: '1', micOn: true, mirrorOn: false,
        }, {
            problems: this._problems,
            phone: this._phone,
            previewRunning: this._service.previewRunning,
            updatedAt: this._updatedAt === null ? null : timestamp(this._updatedAt),
            pipeWireSource: this._pipeWireSource ?? true,
        });

        const key = JSON.stringify([plan, this._errors, this._setupRunning]);
        if (key === this._renderedKey)
            return;
        this._renderedKey = key;

        this.menu.removeAll();

        this.menu.addMenuItem(textItem(plan.header.title, plan.header.subtitle, 'phonecam-header'));

        for (const message of this._errors)
            this.menu.addMenuItem(textItem(message, null, 'phonecam-error'));

        const toggle = new PopupMenu.PopupMenuItem(plan.toggle.label);
        toggle.connect('activate', () => this._act(plan.toggle.argv, {closeMenu: true}));
        this.menu.addMenuItem(toggle);

        const rotation = new PopupMenu.PopupSubMenuMenuItem(plan.rotation.title);
        for (const item of plan.rotation.items) {
            const row = new PopupMenu.PopupMenuItem(item.label);
            if (item.current)
                row.setOrnament(PopupMenu.Ornament.CHECK);
            row.connect('activate', () => this._act(item.argv));
            rotation.menu.addMenuItem(row);
        }
        this.menu.addMenuItem(rotation);

        this.menu.addMenuItem(this._switchItem(plan.mirror));
        this.menu.addMenuItem(this._switchItem(plan.microphone));

        const camera = new PopupMenu.PopupSubMenuMenuItem(plan.camera.title);
        for (const item of plan.camera.items) {
            const row = new PopupMenu.PopupMenuItem(`${item.label} · ${item.detail}`);
            if (item.current)
                row.setOrnament(PopupMenu.Ornament.CHECK);
            row.connect('activate', () => this._act(item.argv));
            camera.menu.addMenuItem(row);
        }
        this.menu.addMenuItem(camera);

        if (plan.pipeWire !== null) {
            const row = new PopupMenu.PopupMenuItem(plan.pipeWire.label);
            row.connect('activate', () => this._restartPipeWire());
            this.menu.addMenuItem(row);
        }

        const preview = new PopupMenu.PopupMenuItem(plan.preview.label);
        preview.connect('activate', () => this._preview());
        this.menu.addMenuItem(preview);

        if (plan.phone !== null)
            this.menu.addMenuItem(textItem(plan.phone.label, null, 'phonecam-row-plain'));

        for (const problem of plan.problems)
            this.menu.addMenuItem(textItem(problem.title, problem.hint, 'phonecam-problem'));

        const setup = new PopupMenu.PopupMenuItem(this._setupRunning
            ? 'Set up the virtual camera (running)'
            : plan.setup.title);
        setup.setSensitive(!this._setupRunning);
        setup.connect('activate', () => this._setup());
        this.menu.addMenuItem(setup);

        // A labelled separator holds the time of the last read.
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(plan.footer.updated));
        this.menu.addMenuItem(this._menuItem('Refresh', () => this.refresh()));
        this.menu.addMenuItem(this._menuItem('Settings', () => this._openPreferences()));
    }

    _switchItem(specification) {
        const item = new PopupMenu.PopupSwitchMenuItem(specification.title, specification.active);
        item.connect('toggled', (_item, state) => this._act(state ? specification.argvOn : specification.argvOff));
        return item;
    }

    _menuItem(label, callback) {
        const item = new PopupMenu.PopupMenuItem(label);
        item.connect('activate', callback);
        return item;
    }

    _onMenuOpen() {
        this._render();
        // The state of the phone is not part of the fast poll.
        this._service.clearPhoneCache();
        this.refresh();
    }

    _onScroll(event) {
        const direction = event.get_scroll_direction();
        if (direction === Clutter.ScrollDirection.UP)
            this._act(nextRotationArgv());
        else if (direction === Clutter.ScrollDirection.DOWN)
            this._act(previousRotationArgv());
        else
            return Clutter.EVENT_PROPAGATE;
        return Clutter.EVENT_STOP;
    }

    _toggle() {
        const running = this._state?.running === true;
        return this._act(running ? ['stop'] : ['start']);
    }

    /** Run one command of the plan and read the state again. */
    async _act(argv, {closeMenu = false} = {}) {
        this._settlingUntil = Date.now() + SETTLING_SECONDS * 1000;
        this._scheduleRefresh();
        if (closeMenu)
            this.menu.close();

        const result = await this._service.run(argv, {timeoutSeconds: timeoutFor(argv)});
        if (this._destroyed)
            return;
        this._errors = result.ok ? [] : [lastLine(result.stderr) || lastLine(result.stdout) ||
            `The command ${argv[0]} failed`];
        this._render();
        await this.refresh();
    }

    async _preview() {
        if (this._service.previewRunning) {
            // The row closes the window that it opened.
            this._service.stopPreview();
            this._errors = [];
            this._render();
            return;
        }
        if (this._state?.running === true) {
            this._service.startPreview();
            this._errors = [];
            this.menu.close();
            this._settlingUntil = Date.now() + SETTLING_SECONDS * 1000;
            this._scheduleRefresh();
            return;
        }
        // Without a stream the engine stops at once and reports the reason.
        const result = await this._service.run(previewArgv(), {timeoutSeconds: 10});
        if (this._destroyed)
            return;
        this._errors = [lastLine(result.stderr) || lastLine(result.stdout) || 'No camera stream runs'];
        this._render();
    }

    /** Let PipeWire read the video devices again, for portal applications. */
    async _restartPipeWire() {
        this._errors = [];
        const result = await this._service.restartPipeWire();
        if (this._destroyed)
            return;
        this._errors = result.ok ? [] : [lastLine(result.stderr) || 'PipeWire did not restart'];
        await this.refresh();
    }

    async _setup() {
        this._setupRunning = true;
        this._render();
        const result = await this._service.runSetup({timeoutSeconds: SETUP_TIMEOUT_SECONDS});
        if (this._destroyed)
            return;
        this._setupRunning = false;
        this._errors = result.ok ? [] : [lastLine(result.stderr) || lastLine(result.stdout) ||
            'The setup failed'];
        await this.refresh();
    }

    destroy() {
        this._destroyed = true;
        if (this._timerId !== 0) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
        if (this._keybinding !== null) {
            Main.wm.removeKeybinding(KEYBINDING_NAME);
            this._keybinding = null;
        }
        this._service?.destroy();
        this._service = null;
        this._settings?.disconnectObject(this);
        St.Settings.get().disconnectObject(this);
        this.menu?.disconnectObject(this);

        /* The widget is a child of the box of the system menu and of the grid
           of that menu. Both come out at disable time. */
        try {
            const quickSettings = Main.panel.statusArea.quickSettings;
            if (quickSettings && this.get_parent() === quickSettings._indicators)
                quickSettings._indicators.remove_child(this);
        } catch (error) {
            logError(error, 'PhoneCam: the panel icon at disable time');
        }
        if (this._Toggle !== null) {
            this._Toggle.get_parent()?.remove_child(this._Toggle);
            this._Toggle._menuManager?.destroy();
        }
        this.menu?.destroy();
        this.menu = null;
        this._Toggle?.destroy();
        this._Toggle = null;
        this.quickSettingsItems = [];

        super.destroy();
    }
});

/** Date and time of a read, for the footer of the menu. */
export function timestamp(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `Updated ${hours}:${minutes}`;
}
