// SPDX-License-Identifier: GPL-3.0-or-later
// State reads and actions for the PhoneCam panel widget.
//
// Every call of the engine goes through one queue, so the widget never starts
// two commands at the same time, and `cancel()` can stop the running command
// at disable time.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ProcessRunner, isRunningArgv, previewArgv, resolveProgram} from './cli.js';
import {
    CAMERAS, DEFAULT_CARD_LABEL, DEFAULT_CAMERA, DEFAULT_ROTATION,
    deviceNode, problemsFor, stateFromFiles,
} from './state.js';

/** Time of the faster read after an action, in seconds. */
export const SETTLING_SECONDS = 12;
/** Time that the answer of `adb get-state` stays valid, in seconds. */
export const PHONE_CACHE_SECONDS = 10;
/** The engine reads its own configuration from this directory. */
const CONFIG_DIRECTORY = 'phonecam';

export class PhoneCamService {
    constructor() {
        this._runner = null;
        this._engine = null;
        this._setup = null;
        this._queue = Promise.resolve();
        this._cancellable = null;
        this._preview = null;
        this._phone = null;
        this._phoneTime = 0;
        this._device = null;
        this._deviceTime = 0;
    }

    /**
     * @param {string} configured - Value of the `engine` setting.
     * @returns {string|null} Absolute path of the engine, or null.
     */
    setEngine(configured) {
        const path = resolveProgram(configured);
        if (path !== this._engine) {
            this._engine = path;
            this._runner = path === null ? null : new ProcessRunner(path);
        }
        return path;
    }

    /** @param {string} configured - Value of the `setup` setting. */
    setSetup(configured) {
        this._setup = resolveProgram(configured);
        return this._setup;
    }

    get engine() {
        return this._engine;
    }

    get setup() {
        return this._setup;
    }

    /** @returns {boolean} True while the preview process runs. */
    get previewRunning() {
        return this._preview !== null && !this._preview.get_if_exited();
    }

    /** Serialize one task behind the running tasks. */
    _enqueue(task) {
        const result = this._queue.then(task, task);
        this._queue = result.then(() => {}, () => {});
        return result;
    }

    /** @returns {string|null} Content of one file, or null. */
    _readFile(path) {
        try {
            const [ok, bytes] = GLib.file_get_contents(path);
            return ok ? new TextDecoder().decode(bytes) : null;
        } catch (_error) {
            return null;
        }
    }

    /** @returns {string|null} Content of one file of the engine, or null. */
    _readConfig(name) {
        return this._readFile(GLib.build_filenamev([GLib.get_user_config_dir(), CONFIG_DIRECTORY, name]));
    }

    /** @returns {Array<{node: string, name: string}>} Video devices from /sys. */
    _readVideoDevices() {
        const entries = [];
        const directory = '/sys/class/video4linux';
        let dir = null;
        try {
            dir = GLib.Dir.open(directory, 0);
        } catch (_error) {
            return entries;
        }
        let name;
        while ((name = dir.read_name()) !== null) {
            if (!name.startsWith('video'))
                continue;
            const label = this._readFile(`${directory}/${name}/name`);
            entries.push({node: name, name: label === null ? null : label.trim()});
        }
        dir.close();
        return entries;
    }

    /** @returns {string|null} The device node of the virtual camera, or null. */
    device() {
        const now = GLib.get_monotonic_time();
        if (this._deviceTime !== 0 && now - this._deviceTime < 2 * 1000 * 1000)
            return this._device;
        this._device = deviceNode(this._readVideoDevices(), DEFAULT_CARD_LABEL);
        this._deviceTime = now;
        return this._device;
    }

    /**
     * Does PipeWire hold the source of our camera? The portal applications get
     * the camera from PipeWire, and PipeWire reads the video devices at its
     * start only.
     * @param {string|null} device - Device node, for example /dev/video10.
     * @returns {Promise<boolean|null>} null when the question failed.
     */
    async pipeWireSource(device) {
        const program = GLib.find_program_in_path('pw-dump');
        if (program === null)
            return null;
        const result = await this._enqueue(() =>
            new ProcessRunner(program).run([], {cancellable: null, timeoutSeconds: 15}));
        if (!result.ok)
            return null;
        const node = (device ?? '').replace('/dev/', '');
        try {
            const entries = JSON.parse(result.stdout);
            return entries.some(entry => {
                const props = entry?.info?.props ?? {};
                if (props['media.class'] !== 'Video/Source')
                    return false;
                return node === '' || String(props['node.name'] ?? '').includes(node);
            });
        } catch (_error) {
            return null;
        }
    }

    /**
     * Let PipeWire read the list of the video devices again, so that a portal
     * application finds the camera while the stream runs.
     * @returns {Promise<object>} Result of the command.
     */
    async restartPipeWire() {
        const program = GLib.find_program_in_path('systemctl');
        if (program === null)
            return {ok: false, stdout: '', stderr: 'systemctl was not found', code: null};
        const runner = new ProcessRunner(program);
        return this._enqueue(() =>
            runner.run(['--user', 'restart', 'pipewire'], {cancellable: null, timeoutSeconds: 30}));
    }

    /** Let the next read ask the phone again, for the open menu. */
    clearPhoneCache() {
        this._phone = null;
        this._phoneTime = 0;
    }

    /**
     * Run the setup command of the module. That command asks for the password
     * with the polkit dialog of the session.
     * @returns {Promise<object>} Result of the command.
     */
    async runSetup({timeoutSeconds = 60} = {}) {
        if (this._setup === null)
            return {ok: false, code: null, stdout: '', stderr: 'The setup command was not found'};
        const runner = new ProcessRunner(this._setup);
        return this._enqueue(() => runner.run([], {cancellable: null, timeoutSeconds}));
    }

    /** @returns {Promise<string|null>} The adb state of the phone, or null. */
    async phoneState() {
        const now = GLib.get_monotonic_time();
        if (this._phone !== null && now - this._phoneTime < PHONE_CACHE_SECONDS * 1000 * 1000)
            return this._phone;

        const adb = GLib.find_program_in_path('adb');
        if (adb === null) {
            this._phone = null;
            this._phoneTime = now;
            return null;
        }

        const runner = new ProcessRunner(adb);
        const result = await this._enqueue(() =>
            runner.run(['get-state'], {cancellable: null, timeoutSeconds: 5}));
        // adb answers on the standard output for a ready phone and on the
        // error output for the other states ("device unauthorized", "offline").
        const text = `${result.stdout}\n${result.stderr}`;
        const answer = result.stdout.trim();
        let state = 'unknown';
        if (/\bunauthorized\b/i.test(text))
            state = 'unauthorized';
        else if (/\boffline\b/i.test(text))
            state = 'offline';
        else if (answer !== '')
            state = answer;
        this._phone = state;
        this._phoneTime = now;
        return this._phone;
    }

    /**
     * Read the whole state of the widget.
     * @returns {Promise<object>} `{state, problems, device, phone}`.
     */
    async read() {
        const files = {
            rotation: this._readConfig('rotation') ?? DEFAULT_ROTATION,
            camera: this._readConfig('camera') ?? DEFAULT_CAMERA,
            mic: this._readConfig('mic') ?? 'on',
            mirror: this._readConfig('mirror') ?? 'off',
        };

        let running = false;
        if (this._runner !== null) {
            const result = await this._enqueue(() => this._runner.run(isRunningArgv(), {cancellable: null}));
            // The engine reports the state through the exit status only.
            running = result.code === 0 && !result.cancelled && !result.timedOut;
        }

        const device = this.device();
        const phone = await this.phoneState();
        const pipeWireSource = await this.pipeWireSource(device);
        const problems = problemsFor({
            engine: this._engine !== null,
            device: device !== null,
            scrcpy: GLib.find_program_in_path('scrcpy') !== null,
            adb: GLib.find_program_in_path('adb') !== null,
            // Without adb there is no answer, and the adb row already covers it.
            phone: phone === null ? undefined : phone,
        });

        return {
            state: stateFromFiles(files, {running}),
            problems,
            device,
            phone,
            pipeWireSource,
        };
    }

    /**
     * Run one action of the engine.
     * @param {string[]} argv - Command arguments from the plan.
     * @returns {Promise<object>} `{ok, stdout, stderr, code}`.
     */
    async run(argv, {timeoutSeconds = undefined} = {}) {
        if (this._runner === null)
            return {ok: false, stdout: '', stderr: 'The phonecam command was not found', code: null};
        const options = {cancellable: null};
        if (timeoutSeconds !== undefined)
            options.timeoutSeconds = timeoutSeconds;
        return this._enqueue(() => this._runner.run(argv, options));
    }

    /** Open the preview window. @returns {boolean} True when the process started. */
    startPreview() {
        if (this._runner === null)
            return false;
        if (this.previewRunning)
            return true;
        this._preview = this._runner.spawnDetached(previewArgv());
        return this._preview !== null;
    }

    /** Stop the preview window. The engine stops ffplay itself on SIGTERM. */
    stopPreview() {
        const preview = this._preview;
        if (preview === null)
            return;
        this._preview = null;
        if (preview.get_if_exited())
            return;
        preview.send_signal(15);
        // Never wait in the main loop of the shell: force the end later.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            if (!preview.get_if_exited())
                preview.force_exit();
            return GLib.SOURCE_REMOVE;
        });
    }

    /** Stop the running command and the preview window. */
    cancel() {
        this._cancellable?.cancel();
        this._runner?.cancel();
        this.stopPreview();
    }

    destroy() {
        this.cancel();
        this._runner = null;
        this._engine = null;
        this._setup = null;
        this._cancellable = null;
        this._queue = Promise.resolve();
    }
}
