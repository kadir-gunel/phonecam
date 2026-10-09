// SPDX-License-Identifier: GPL-3.0-or-later
// The argument lists of the PhoneCam engine.
//
// The engine is the command `bin/phonecam`, which comes with the PhoneCam app
// and not with this widget. The widget sends these lists to the app over
// D-Bus, and the app starts the engine. This module is pure: it holds no
// subprocess and no GNOME Shell import, so a plain `gjs` run can test it.

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
