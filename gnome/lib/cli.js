// SPDX-License-Identifier: MIT
// Engine access for the PhoneCam panel widget.
//
// The engine is the command bin/phonecam of this repository. It does the work:
// scrcpy, adb, the v4l2loopback device, and the virtual microphone. This
// module only starts the command and reads its answer.
//
// This module has no GNOME Shell import, so a plain `gjs` run can test it.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/** Time limit of a normal engine command. */
export const ENGINE_TIMEOUT_SECONDS = 20;
/** Time limit of `start`: the engine searches the phone for up to 20 seconds,
 *  then it starts scrcpy and moves the sound of scrcpy. */
export const START_TIMEOUT_SECONDS = 45;
/** Time limit of a command that stops the stream and starts it again: the
 *  rotation, the camera, the mirror, and the microphone. The limit holds a
 *  whole `stop` (up to 10 seconds) and a whole `start`. */
export const RESTART_TIMEOUT_SECONDS = 75;

/**
 * The time limit of a command of the engine.
 * @param {string[]} argv - Arguments of the command.
 * @returns {number} The limit in seconds.
 */
export function timeoutFor(argv) {
    const verb = argv?.[0] ?? '';
    if (verb === 'start')
        return START_TIMEOUT_SECONDS;
    if (['rotate', 'camera', 'mirror', 'mic'].includes(verb))
        return RESTART_TIMEOUT_SECONDS;
    return ENGINE_TIMEOUT_SECONDS;
}

export function startArgv() {
    return ['start'];
}

export function stopArgv() {
    return ['stop'];
}

export function statusArgv() {
    return ['status'];
}

/** The exit status of this command is the state: 0 means the stream runs. */
export function isRunningArgv() {
    return ['is-running'];
}

export function rotateArgv(value) {
    return ['rotate', String(value)];
}

export function nextRotationArgv() {
    return ['cycle-rotation'];
}

export function previousRotationArgv() {
    return ['prev-rotation'];
}

export function cameraArgv(id) {
    return ['camera', String(id)];
}

export function mirrorArgv(on) {
    return ['mirror', on ? 'on' : 'off'];
}

export function micArgv(on) {
    return ['mic', on ? 'on' : 'off'];
}

export function previewArgv() {
    return ['preview'];
}

/**
 * @param {string} configured - Name or path from the settings.
 * @returns {string|null} Absolute program path, or null.
 */
export function resolveProgram(configured) {
    const value = (configured ?? '').trim();
    if (value === '')
        return null;
    if (value.includes('/'))
        return GLib.file_test(value, GLib.FileTest.IS_EXECUTABLE) ? value : null;
    return GLib.find_program_in_path(value) ?? null;
}

/**
 * Runs the engine. One instance holds one running command, so `cancel()` can
 * stop it at disable time.
 */
export class ProcessRunner {
    constructor(program) {
        this._program = program;
        this._process = null;
    }

    get program() {
        return this._program;
    }

    /**
     * One command with an answer.
     * @param {string[]} argv - Arguments after the program name.
     * @returns {Promise<object>} `{ok, code, stdout, stderr, timedOut, cancelled}`.
     */
    async run(argv, {cancellable = null, timeoutSeconds = ENGINE_TIMEOUT_SECONDS} = {}) {
        let process;
        try {
            const launcher = new Gio.SubprocessLauncher({
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            // The engine must never wait for an answer of a terminal.
            launcher.setenv('PHONECAM_NONINTERACTIVE', '1', true);
            process = launcher.spawnv([this._program, ...argv]);
        } catch (error) {
            return {ok: false, code: null, stdout: '', stderr: error.message, cancelled: false};
        }

        this._process = process;
        let timedOut = false;
        let timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, timeoutSeconds, () => {
            timeoutId = 0;
            timedOut = true;
            process.force_exit();
            return GLib.SOURCE_REMOVE;
        });

        try {
            const [, stdout, stderr] = await new Promise((resolve, reject) => {
                process.communicate_utf8_async(null, cancellable, (source, result) => {
                    try {
                        resolve(source.communicate_utf8_finish(result));
                    } catch (error) {
                        reject(error);
                    }
                });
            });
            const code = process.get_exit_status();
            return {
                ok: !timedOut && process.get_successful(),
                code,
                stdout: stdout ?? '',
                stderr: stderr ?? '',
                timedOut,
                cancelled: false,
            };
        } catch (error) {
            if (cancellable?.is_cancelled())
                return {ok: false, code: null, stdout: '', stderr: error.message, cancelled: true};
            return {ok: false, code: null, stdout: '', stderr: error.message, cancelled: false};
        } finally {
            if (timeoutId !== 0)
                GLib.source_remove(timeoutId);
            this._process = null;
        }
    }

    /**
     * One command without an answer and without a pipe, for the preview
     * window. The caller keeps the process to stop it at disable time.
     * @returns {Gio.Subprocess|null}
     */
    spawnDetached(argv) {
        try {
            const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
            launcher.setenv('PHONECAM_NONINTERACTIVE', '1', true);
            return launcher.spawnv([this._program, ...argv]);
        } catch (_error) {
            return null;
        }
    }

    /** Stop the running command. */
    cancel() {
        this._process?.force_exit();
    }
}
