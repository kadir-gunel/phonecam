// SPDX-License-Identifier: MIT
// The state of PhoneCam and the plan of the menu.
//
// This module is pure: it takes the content of the files of the engine and
// the result of the probes, and it returns plain objects. There is no
// subprocess and no GNOME Shell import, so a plain `gjs` run can test it.

import {
    cameraArgv, micArgv, mirrorArgv, previewArgv, rotateArgv, startArgv, stopArgv,
} from './cli.js';

/** The rotation values of the engine, in the order of the wheel. */
export const ROTATIONS = ['0', '90', '180', '270'];

/** The cameras of the phone, as the engine documents them. */
export const CAMERAS = [
    {id: '0', label: 'Camera 0', detail: 'main camera on the back'},
    {id: '1', label: 'Camera 1', detail: 'front camera'},
    {id: '2', label: 'Camera 2', detail: 'camera on the back, largest sensor'},
    {id: '3', label: 'Camera 3', detail: 'camera on the back'},
];

export const DEFAULT_CARD_LABEL = 'PhoneCam Camera';
export const DEFAULT_CAMERA = '1';
export const DEFAULT_ROTATION = '0';

/**
 * Read one value of a file of the engine.
 * @param {string|null} text - Content of the file.
 * @param {string[]} allowed - The values that the engine accepts.
 * @param {string} fallback - The value of the engine when the file is absent.
 * @returns {string} The value.
 */
export function readValue(text, allowed, fallback) {
    const value = String(text ?? '').split('\n')[0].trim();
    return allowed.includes(value) ? value : fallback;
}

/**
 * The state of the widget.
 * @param {object} files - Content per file: `rotation`, `camera`, `mic`, `mirror`.
 * @param {object} options - `running` from the command `is-running`.
 * @returns {object} State with `running`, `rotation`, `camera`, `micOn`, `mirrorOn`.
 */
export function stateFromFiles(files, {running = false} = {}) {
    return {
        running,
        rotation: readValue(files?.rotation, ROTATIONS, DEFAULT_ROTATION),
        camera: readValue(files?.camera, CAMERAS.map(camera => camera.id), DEFAULT_CAMERA),
        micOn: readValue(files?.mic, ['on', 'off'], 'on') === 'on',
        mirrorOn: readValue(files?.mirror, ['on', 'off'], 'off') === 'on',
    };
}

/** @returns {string} The value that the engine gives to scrcpy, for example flip90. */
export function orientationOf(state) {
    return state.mirrorOn ? `flip${state.rotation}` : state.rotation;
}

/**
 * The device of the card label.
 * @param {Array<{node: string, name: string}>} entries - Video devices from /sys.
 * @returns {string|null} The device node, for example /dev/video10.
 */
export function deviceNode(entries, label = DEFAULT_CARD_LABEL) {
    const entry = (entries ?? []).find(item => item?.name === label);
    return entry ? `/dev/${entry.node}` : null;
}

/**
 * The problem of the phone, if there is one.
 * @param {string|undefined} phone - State from `adb get-state`.
 * @returns {{title: string, hint: string}|null} The problem, or null.
 */
export function phoneProblem(phone) {
    if (phone === undefined || phone === null || phone === 'device')
        return null;
    if (phone === 'unauthorized')
        return {title: 'The phone waits for the USB-debugging answer',
            hint: 'Unlock the phone and accept the question'};
    if (phone === 'offline')
        return {title: 'The phone is offline', hint: 'Connect the phone again'};
    return {title: 'The phone is not connected',
        hint: 'Connect the phone by USB and allow USB debugging'};
}

/**
 * The action that makes the camera visible to an application that asks the
 * camera portal. PipeWire reads the video devices at its start, and an idle
 * loopback device reports no capture ability, so the node of the camera can be
 * absent while the stream runs.
 * @param {object} state - Result of `stateFromFiles()`.
 * @param {object} probes - `pipeWireSource`: true when PipeWire holds a source.
 * @returns {{label: string, action: string}|null} The row, or null.
 */
export function pipeWireRow(state, {pipeWireSource = true} = {}) {
    if (!state.running || pipeWireSource)
        return null;
    return {label: 'Restart PipeWire (for portal applications)', action: 'restart-pipewire'};
}

/**
 * The items that stop the function.
 * @param {object} probes - `engine`, `scrcpy`, `adb`, `device`, `phone`.
 * @returns {Array<{title: string, hint: string}>} One entry per missing item.
 */
export function problemsFor(probes = {}) {
    const problems = [];
    if (probes.engine === false)
        problems.push({title: 'The phonecam command was not found', hint: 'Set the path in the settings'});
    if (probes.device === false)
        problems.push({title: 'The virtual camera is missing', hint: 'Run "Set up the virtual camera"'});
    if (probes.scrcpy === false)
        problems.push({title: 'scrcpy is not installed', hint: 'pacman -S scrcpy'});
    if (probes.adb === false)
        problems.push({title: 'adb is not installed', hint: 'pacman -S android-tools'});
    const phone = phoneProblem(probes.phone);
    if (phone !== null)
        problems.push(phone);
    return problems;
}

/** @returns {string} The second line of the head of the menu. */
export function statusLine(state) {
    const stateText = state.running ? 'Streaming' : 'Stopped';
    const microphone = state.micOn ? 'microphone on' : 'microphone off';
    return `${stateText} · camera ${state.camera} · ${orientationOf(state)} · ${microphone}`;
}

/**
 * The plan of the menu. The indicator turns this plan into widgets.
 * @param {object} state - Result of `stateFromFiles()`.
 * @param {object} context - `problems`, `phone`, `device`, `previewRunning`, `updatedAt`.
 * @returns {object} Plain data: every row holds its own command arguments.
 */
export function planMenu(state, context = {}) {
    const {
        problems = [], phone = null, previewRunning = false, updatedAt = null,
        pipeWireSource = true,
    } = context;

    return {
        header: {title: 'PhoneCam', subtitle: statusLine(state)},
        toggle: state.running
            ? {label: 'Stop the stream', argv: stopArgv()}
            : {label: 'Start the stream', argv: startArgv()},
        rotation: {
            title: 'Turn the picture',
            current: state.rotation,
            items: ROTATIONS.map(value => ({
                label: value === '0' ? '0 (phone in landscape)' : value,
                value,
                current: value === state.rotation,
                argv: rotateArgv(value),
            })),
        },
        mirror: {
            title: 'Mirror',
            active: state.mirrorOn,
            argvOn: mirrorArgv(true),
            argvOff: mirrorArgv(false),
        },
        microphone: {
            title: 'Microphone',
            active: state.micOn,
            argvOn: micArgv(true),
            argvOff: micArgv(false),
        },
        camera: {
            title: 'Camera',
            current: state.camera,
            items: CAMERAS.map(camera => ({
                label: camera.label,
                detail: camera.detail,
                id: camera.id,
                current: camera.id === state.camera,
                argv: cameraArgv(camera.id),
            })),
        },
        pipeWire: pipeWireRow(state, {pipeWireSource}),
        preview: {
            label: previewRunning ? 'Preview window (open)' : 'Preview window',
            argv: previewArgv(),
            running: previewRunning,
        },
        // A phone that is not ready appears in the problems, with the fix.
        phone: phone === 'device' ? {label: 'Phone: connected'} : null,
        problems,
        setup: {title: 'Set up the virtual camera'},
        footer: {updated: updatedAt === null ? 'Not read yet' : updatedAt},
    };
}
