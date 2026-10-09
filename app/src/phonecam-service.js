// SPDX-License-Identifier: GPL-3.0-or-later
// The D-Bus service of PhoneCam.
//
// The app owns the engine (bin/phonecam). This class runs it and reads the
// state of the stream, and the session bus carries both to the front-end (the
// GNOME Shell extension). Every command of the engine goes through one queue,
// so two commands never run at the same time.
//
// The methods of this class carry the exact names of
// io.github.kadir_gunel.PhoneCam.xml: GJS looks a method up by the name of the
// XML, and it takes the IN args as the arguments of the call. A method with
// several OUT args returns an array, and a method with no OUT arg returns
// nothing.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {CAMERAS, DEFAULT_CARD_LABEL, deviceNode, problemsFor, stateFromFiles} from './state.js';

/** The name of the service on the session bus. */
export const SERVICE_NAME = 'io.github.kadir_gunel.PhoneCam';
/** The object path of the interface. */
export const OBJECT_PATH = '/io/github/kadir_gunel/PhoneCam';

/**
 * The directory of this module. The engine is installed beside the modules, so
 * the app never writes a path of the build machine into a file.
 */
const MODULE_DIR = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
/** The engine of the app. */
export const ENGINE = GLib.build_filenamev([MODULE_DIR, 'bin', 'phonecam']);
/** The command that installs or repairs the virtual camera. */
export const SETUP = GLib.build_filenamev([MODULE_DIR, 'bin', 'phonecam-setup']);
/** The interface of the service, installed beside this module. */
export const INTERFACE_FILE = GLib.build_filenamev([MODULE_DIR, `${SERVICE_NAME}.xml`]);

/** Time limit of a normal command of the engine. */
const ENGINE_TIMEOUT_SECONDS = 20;
/** Time limit of `start`: the engine searches the phone, then it starts scrcpy. */
const START_TIMEOUT_SECONDS = 45;
/** Time limit of a command that stops the stream and starts it again. */
const RESTART_TIMEOUT_SECONDS = 75;
/** Time limit of `adb get-state`. */
const PHONE_TIMEOUT_SECONDS = 5;
/** Time limit of `pw-dump`. */
const PIPE_WIRE_TIMEOUT_SECONDS = 15;
/** Time limit of the restart of PipeWire. */
const SYSTEMCTL_TIMEOUT_SECONDS = 30;
/** Time limit of the setup command. It asks for the password. */
const SETUP_TIMEOUT_SECONDS = 300;
/** Time that the answer of `adb get-state` stays valid, in seconds. */
const PHONE_CACHE_SECONDS = 10;
/** The signal that asks the preview window to close. */
const PREVIEW_SIGNAL = 15;
/** Time that the preview gets after the signal, in milliseconds. */
const PREVIEW_KILL_MS = 2000;
/** Time that a command gets after its limit to hand over its output. A child
 *  of the command can hold the pipes (scrcpy holds them for `phonecam run`),
 *  and the limit must hold. */
const TIMEOUT_GRACE_MS = 2000;
/** The engine reads its own configuration from this directory. */
const CONFIG_DIRECTORY = 'phonecam';
/** The time limits of the engine, per verb. */
const VERB_TIMEOUTS = new Map([
    ['start', START_TIMEOUT_SECONDS],
    ['rotate', RESTART_TIMEOUT_SECONDS],
    ['camera', RESTART_TIMEOUT_SECONDS],
    ['mirror', RESTART_TIMEOUT_SECONDS],
    ['mic', RESTART_TIMEOUT_SECONDS],
]);

/**
 * The time limit of a command of the engine.
 * @param {string[]} argv - Arguments of the command.
 * @returns {number} The time limit in seconds.
 */
function timeoutFor(argv) {
    return VERB_TIMEOUTS.get(argv?.[0] ?? '') ?? ENGINE_TIMEOUT_SECONDS;
}

/** @returns {string} The interface of the service, read from its file. */
export function interfaceXml() {
    const [, bytes] = GLib.file_get_contents(INTERFACE_FILE);
    return new TextDecoder().decode(bytes);
}

/**
 * @param {string} path - Path of a file.
 * @returns {string|null} Content of the file, or null when the file is absent.
 */
function readTextFile(path) {
    try {
        const [, bytes] = GLib.file_get_contents(path);
        return new TextDecoder().decode(bytes);
    } catch (_error) {
        return null;
    }
}

/** @returns {Array<{node: string, name: string|null}>} Video devices from /sys. */
function videoDevices() {
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
        const label = readTextFile(`${directory}/${name}/name`);
        entries.push({node: name, name: label === null ? null : label.trim()});
    }
    dir.close();
    return entries;
}

/**
 * The state of the phone, from the answer of `adb get-state`. adb answers on
 * the standard output for a ready phone and on the error output for the other
 * states.
 * @param {object} result - Result of the command.
 * @returns {string} `device`, `unauthorized`, `offline`, `unknown`, or the answer.
 */
function phoneStateOf(result) {
    const text = `${result.stdout}\n${result.stderr}`;
    if (/\bunauthorized\b/i.test(text))
        return 'unauthorized';
    if (/\boffline\b/i.test(text))
        return 'offline';
    const answer = (result.stdout ?? '').trim().split('\n')[0].trim();
    return answer === '' ? 'unknown' : answer;
}

/**
 * The message that explains a failed command.
 * @param {string} command - The command, as the user writes it.
 * @param {object} result - Result of the command.
 * @param {number} timeoutSeconds - The limit that was given to the command.
 * @returns {string} One line for the signal `Error`.
 */
function failureMessage(command, result, timeoutSeconds) {
    if (result.timedOut)
        return `${command}: the command passed ${timeoutSeconds} seconds`;
    const detail = (result.stderr ?? '').trim() || (result.stdout ?? '').trim();
    if (detail !== '')
        return detail;
    return `${command}: the command failed with status ${result.code}`;
}

/**
 * The text of the signal `StateChanged`. It holds the same fields as
 * GetState(), so a front-end that reads the signal does not need a second call.
 * @param {object} state - Result of `_readState()`.
 * @returns {string} One JSON object.
 */
function stateText(state) {
    return JSON.stringify({
        running: state.running,
        preview_running: state.previewRunning,
        rotation: state.rotation,
        camera: state.camera,
        mic_on: state.micOn,
        mirror_on: state.mirrorOn,
        device: state.device ?? '',
        phone: state.phone ?? '',
        pipewire_source: state.pipewireSource,
        problems: state.problems.map(problem => [problem.title, problem.hint]),
    });
}

/** The D-Bus service of the app, wrapped by Gio.DBusExportedObject. */
export class PhoneCamService {
    constructor() {
        this._queue = Promise.resolve();
        this._exported = null;
        this._preview = null;
        this._phone = null;
        this._phoneTime = 0;
        this._lastState = null;
    }

    /**
     * Give the exported object to the service, so that it can emit the signals
     * of the interface.
     * @param {Gio.DBusExportedObject} exported - The wrapper of this instance.
     */
    setExportedObject(exported) {
        this._exported = exported;
    }

    /**
     * @returns {boolean} True while the preview process runs. The answer comes
     * from the child watch of the process: Gio.Subprocess refuses the question
     * `get_if_exited()` while the process lives without a watch, and it warns.
     */
    get previewRunning() {
        return this._preview !== null && this._preview.alive;
    }

    /**
     * Run one task after the running tasks, so that two commands of the engine
     * never overlap.
     * @param {function(): Promise<any>} task - The task.
     * @returns {Promise<any>} The result of the task.
     */
    _enqueue(task) {
        const result = this._queue.then(task);
        this._queue = result.then(() => {}, () => {});
        return result;
    }

    /**
     * Start one program and collect its output.
     *
     * The limit is hard: a child of the command can hold the pipes of this
     * process, so the call settles a short time after the limit even when the
     * end of the read has not arrived.
     * @param {string} program - Absolute path of the program.
     * @param {string[]} argv - Arguments after the program name.
     * @param {number} timeoutSeconds - Time limit of the command.
     * @returns {Promise<object>} `{ok, code, stdout, stderr, timedOut}`.
     */
    _run(program, argv, timeoutSeconds) {
        return new Promise(resolve => {
            let process = null;
            try {
                const launcher = new Gio.SubprocessLauncher({
                    flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
                });
                process = launcher.spawnv([program, ...argv]);
            } catch (error) {
                resolve({ok: false, code: -1, stdout: '', stderr: error.message, timedOut: false});
                return;
            }

            const expired = `${program}: the command passed ${timeoutSeconds} seconds`;
            let timedOut = false;
            let settled = false;
            let timeoutId = 0;
            let graceId = 0;

            const finish = (code, stdout, stderr) => {
                if (settled)
                    return;
                settled = true;
                if (timeoutId !== 0) {
                    GLib.source_remove(timeoutId);
                    timeoutId = 0;
                }
                if (graceId !== 0) {
                    GLib.source_remove(graceId);
                    graceId = 0;
                }
                resolve({ok: code === 0 && !timedOut, code, stdout, stderr, timedOut});
            };

            timeoutId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT, Math.max(1, Math.round(timeoutSeconds)), () => {
                    timeoutId = 0;
                    timedOut = true;
                    process.force_exit();
                    // Close this end of the pipes, and settle without the
                    // output when the end of the read does not arrive.
                    try {
                        process.get_stdout_pipe().close(null);
                        process.get_stderr_pipe().close(null);
                    } catch (_error) {
                    }
                    graceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TIMEOUT_GRACE_MS, () => {
                        graceId = 0;
                        finish(-1, '', expired);
                        return GLib.SOURCE_REMOVE;
                    });
                    return GLib.SOURCE_REMOVE;
                });

            process.communicate_utf8_async(null, null, (source, result) => {
                let stdout = '';
                let stderr = '';
                try {
                    [, stdout, stderr] = source.communicate_utf8_finish(result);
                } catch (error) {
                    stderr = error.message;
                }
                if (timedOut) {
                    finish(-1, stdout ?? '', expired);
                    return;
                }
                // The status of the process is valid only after the child
                // watch has reported its end.
                source.wait_async(null, () => {
                    const code = source.get_if_signaled()
                        ? 128 + source.get_term_sig()
                        : source.get_exit_status();
                    finish(code, stdout ?? '', stderr ?? '');
                });
            });
        });
    }

    /** @returns {boolean} True when the engine is installed and runnable. */
    _engineAvailable() {
        return GLib.file_test(ENGINE, GLib.FileTest.IS_EXECUTABLE);
    }

    /**
     * Run one command of the engine.
     * @param {string[]} argv - Arguments after the engine name.
     * @returns {Promise<object>} `{ok, code, stdout, stderr, timedOut}`.
     */
    async _runEngine(argv) {
        if (!this._engineAvailable()) {
            return {ok: false, code: -1, stdout: '', stderr: `The command ${ENGINE} was not found`,
                timedOut: false};
        }
        return this._enqueue(() => this._run(ENGINE, argv, timeoutFor(argv)));
    }

    /**
     * Emit one signal of the interface. Both signals of the interface carry
     * one string, and the parameters of a signal are one tuple variant.
     * @param {string} name - Name of the signal.
     * @param {string} text - Its argument.
     */
    _emit(name, text) {
        if (this._exported === null)
            return;
        try {
            this._exported.emit_signal(name, new GLib.Variant('(s)', [text]));
        } catch (error) {
            logError(error, `PhoneCam: the signal ${name} failed`);
        }
    }

    /** @param {string} message - The failure that the front-end must show. */
    _emitError(message) {
        const text = String(message ?? '').trim();
        if (text !== '')
            this._emit('Error', text);
    }

    /**
     * Emit `StateChanged` when the state is not the one of the last signal.
     * Call it after a command that can change the state.
     */
    async _notifyStateChanged() {
        let state = null;
        try {
            state = await this._readState();
        } catch (_error) {
            return;
        }
        const text = stateText(state);
        if (text === this._lastState)
            return;
        this._lastState = text;
        this._emit('StateChanged', text);
    }

    /** @returns {Promise<string|null>} The adb state of the phone, or null. */
    async phoneState() {
        const now = GLib.get_monotonic_time();
        if (this._phoneTime !== 0 && now - this._phoneTime < PHONE_CACHE_SECONDS * 1000 * 1000)
            return this._phone;

        const adb = GLib.find_program_in_path('adb');
        if (adb === null) {
            this._phone = null;
            this._phoneTime = 0;
            return null;
        }

        const result = await this._enqueue(() => this._run(adb, ['get-state'], PHONE_TIMEOUT_SECONDS));
        this._phone = phoneStateOf(result);
        this._phoneTime = GLib.get_monotonic_time();
        return this._phone;
    }

    /**
     * Does PipeWire hold the source of the camera? Portal applications get the
     * camera from PipeWire, and PipeWire reads the video devices at its start.
     * @param {string|null} device - Device node, for example /dev/video10.
     * @returns {Promise<boolean>} True when a source of the device is present.
     */
    async _pipeWireSource(device) {
        if (device === null)
            return false;
        const program = GLib.find_program_in_path('pw-dump');
        if (program === null)
            return false;
        const result = await this._enqueue(() =>
            this._run(program, [], PIPE_WIRE_TIMEOUT_SECONDS));
        if (!result.ok)
            return false;
        const node = device.replace('/dev/', '');
        try {
            const entries = JSON.parse(result.stdout);
            return entries.some(entry => {
                const props = entry?.info?.props ?? {};
                if (props['media.class'] !== 'Video/Source')
                    return false;
                return String(props['node.name'] ?? '').includes(node);
            });
        } catch (_error) {
            return false;
        }
    }

    /** @returns {Promise<object>} The whole state of the app. */
    async _readState() {
        const files = {};
        for (const name of ['rotation', 'camera', 'mic', 'mirror'])
            files[name] = readTextFile(GLib.build_filenamev([
                GLib.get_user_config_dir(), CONFIG_DIRECTORY, name]));

        const runningResult = await this._runEngine(['is-running']);
        const running = runningResult.code === 0;
        const device = deviceNode(videoDevices(), DEFAULT_CARD_LABEL);
        const phone = await this.phoneState();
        const pipewireSource = await this._pipeWireSource(device);
        const problems = problemsFor({
            engine: this._engineAvailable(),
            device: device !== null,
            scrcpy: GLib.find_program_in_path('scrcpy') !== null,
            adb: GLib.find_program_in_path('adb') !== null,
            // Without adb there is no answer, and the adb row already covers it.
            phone: phone === null ? undefined : phone,
        });

        return {
            ...stateFromFiles(files, {running}),
            previewRunning: this.previewRunning,
            device,
            phone,
            pipewireSource,
            problems,
        };
    }

    /* ------------------------------------------------ the methods of the bus */

    /**
     * Run one command of the engine, for example ["rotate", "90"].
     * @param {string[]} argv - Arguments after the engine name.
     * @returns {Promise<Array>} `[ok, code, stdout, stderr]`.
     */
    async Run(argv) {
        const args = (argv ?? []).map(String);
        if (args.length === 0)
            return [false, -1, '', 'no command'];
        // The preview window runs until it is stopped: it never goes through
        // the queue, and the caller stops it with StopPreview().
        if (args[0] === 'preview') {
            const [ok, error] = await this.StartPreview();
            return [ok, ok ? 0 : -1, '', error];
        }

        const result = await this._runEngine(args);
        if (!result.ok)
            this._emitError(failureMessage(`phonecam ${args.join(' ')}`, result, timeoutFor(args)));
        await this._notifyStateChanged();
        return [result.ok, result.code, result.stdout, result.stderr];
    }

    /**
     * The state of the app.
     * @returns {Promise<Array>} The OUT args of GetState, in the order of the XML.
     */
    async GetState() {
        const state = await this._readState();
        return [
            state.running,
            state.previewRunning,
            state.rotation,
            state.camera,
            state.micOn,
            state.mirrorOn,
            state.device ?? '',
            state.phone ?? '',
            state.pipewireSource,
            state.problems.map(problem => [problem.title, problem.hint]),
        ];
    }

    /**
     * The cameras of the phone, as the engine documents them.
     * @returns {Array<string[]>} `[ids, names]`.
     */
    GetCameras() {
        return [
            CAMERAS.map(camera => camera.id),
            CAMERAS.map(camera => camera.label),
        ];
    }

    /**
     * Open the preview window.
     * @returns {Promise<Array>} `[ok, error]`.
     */
    async StartPreview() {
        if (this.previewRunning)
            return [true, ''];
        if (!this._engineAvailable())
            return [false, `The command ${ENGINE} was not found`];

        let process = null;
        try {
            const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
            process = launcher.spawnv([ENGINE, 'preview']);
        } catch (error) {
            this._preview = null;
            this._emitError(`phonecam preview: ${error.message}`);
            return [false, error.message];
        }

        /* The preview runs until it is stopped, so nothing waits for it here.
           Keep the process and one promise that the child watch resolves, and
           never ask Gio.Subprocess about a process that has no watch. */
        const preview = {process, alive: true, exit: null};
        preview.exit = new Promise(resolve => process.wait_async(null, () => {
            preview.alive = false;
            resolve();
        }));
        this._preview = preview;

        await this._notifyStateChanged();
        return [true, ''];
    }

    /**
     * Close the preview window. The engine stops ffplay itself on SIGTERM.
     * @returns {Promise<Array>} `[ok, error]`.
     */
    async StopPreview() {
        const preview = this._preview;
        this._preview = null;
        if (preview === null)
            return [true, ''];

        if (preview.alive) {
            preview.process.send_signal(PREVIEW_SIGNAL);
            // ffplay can stay alive while the device is away: force the end of
            // the preview after a short time.
            let killId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PREVIEW_KILL_MS, () => {
                killId = 0;
                if (preview.alive)
                    preview.process.force_exit();
                return GLib.SOURCE_REMOVE;
            });
            await preview.exit;
            if (killId !== 0)
                GLib.source_remove(killId);
        }

        await this._notifyStateChanged();
        return [true, ''];
    }

    /**
     * Let PipeWire read the list of the video devices again, so that a portal
     * application finds the camera while the stream runs.
     * @returns {Promise<Array>} `[ok, error]`.
     */
    async RestartPipeWire() {
        const program = GLib.find_program_in_path('systemctl');
        if (program === null) {
            const error = 'The command systemctl was not found';
            this._emitError(error);
            return [false, error];
        }

        const argv = ['--user', 'restart', 'pipewire'];
        const result = await this._enqueue(() =>
            this._run(program, argv, SYSTEMCTL_TIMEOUT_SECONDS));
        if (!result.ok) {
            const error = failureMessage(`systemctl ${argv.join(' ')}`, result,
                SYSTEMCTL_TIMEOUT_SECONDS);
            this._emitError(error);
            return [false, error];
        }
        return [true, ''];
    }

    /**
     * Install or repair the virtual camera. The command asks for the password.
     * @returns {Promise<Array>} `[ok, error]`.
     */
    async RunSetup() {
        if (!GLib.file_test(SETUP, GLib.FileTest.IS_EXECUTABLE)) {
            const error = `The command ${SETUP} was not found`;
            this._emitError(error);
            return [false, error];
        }

        const result = await this._enqueue(() => this._run(SETUP, [], SETUP_TIMEOUT_SECONDS));
        if (!result.ok) {
            const error = failureMessage('phonecam-setup', result, SETUP_TIMEOUT_SECONDS);
            this._emitError(error);
            return [false, error];
        }
        return [true, ''];
    }

    /** Let the next read ask the phone again. */
    ClearPhoneCache() {
        this._phone = null;
        this._phoneTime = 0;
    }

    /** Stop the preview window and forget the exported object. */
    destroy() {
        const preview = this._preview;
        this._preview = null;
        if (preview !== null && preview.alive) {
            preview.process.send_signal(PREVIEW_SIGNAL);
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, PREVIEW_KILL_MS, () => {
                if (preview.alive)
                    preview.process.force_exit();
                return GLib.SOURCE_REMOVE;
            });
        }
        this._exported = null;
    }
}
