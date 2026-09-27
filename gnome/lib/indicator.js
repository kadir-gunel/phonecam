// SPDX-License-Identifier: MIT
// The panel indicator of PhoneCam: the icon, the menu, the wheel, and the
// keyboard shortcut.
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
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

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
const SETUP_TIMEOUT_SECONDS = 60;

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

export const PhoneCamIndicator = GObject.registerClass(
class PhoneCamIndicator extends PanelMenu.Button {
    _init(settings, {openPreferences, directory}) {
        super._init(0.5, 'PhoneCam', false);

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

        this._buildPanel();
        this._applySettings();
        this._connectSettings();

        St.Settings.get().connectObject('notify::color-scheme', () => this._syncStyle(), this);
        this._syncStyle();

        this.menu.actor.add_style_class_name('phonecam-menu');
        this.menu.connectObject('open-state-changed', (_menu, open) => {
            if (open)
                this._onMenuOpen();
        }, this);

        this._render();
        this._scheduleRefresh();
        this.refresh();
    }

    _buildPanel() {
        this._panelBox = new St.BoxLayout({style_class: 'phonecam-panel-box'});
        this._icon = new St.Icon({
            icon_name: PANEL_ICON_NAME,
            fallback_icon_name: 'camera-photo-symbolic',   /* not camera-web: see above */
            style_class: 'system-status-icon',
        });
        this._panelBox.add_child(this._icon);
        this.add_child(this._panelBox);

        this.connect('scroll-event', (_actor, event) => this._onScroll(event));
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
        for (const widget of [this._panelBox, this.menu.actor]) {
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

    _updatePanel() {
        const running = this._state?.running === true;
        if (running)
            this._panelBox.add_style_class_name('phonecam-live');
        else
            this._panelBox.remove_style_class_name('phonecam-live');

        const parts = [running ? 'streaming' : 'stopped'];
        if (this._problems.length > 0)
            parts.push(`${this._problems.length} problem${this._problems.length === 1 ? '' : 's'}`);
        this.accessible_name = `PhoneCam: ${parts.join(', ')}`;
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
        super.destroy();
    }
});

/** Date and time of a read, for the footer of the menu. */
export function timestamp(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `Updated ${hours}:${minutes}`;
}
