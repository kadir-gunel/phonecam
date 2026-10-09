// SPDX-License-Identifier: GPL-3.0-or-later
// The D-Bus client of the PhoneCam app.
//
// The app (see `app/`) holds the engine and the setup commands. This module is
// the only place of the widget that talks to the app. The interface lives in
// `app/io.github.kadir_gunel.PhoneCam.xml`; the two halves must stay equal.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/** The well-known name of the app on the session bus. */
export const SERVICE_NAME = 'io.github.kadir_gunel.PhoneCam';
/** The object path of the app. */
export const OBJECT_PATH = '/io/github/kadir_gunel/PhoneCam';
/** The interface of the app. */
export const INTERFACE_NAME = 'io.github.kadir_gunel.PhoneCam';

/** The text of an error, without the private part of the remote message. */
export function messageOf(error) {
    if (error instanceof Gio.DBusError)
        Gio.DBusError.strip_remote_error(error);
    return error?.message ?? String(error);
}

export class DBusClient {
    constructor() {
        /* The well-known name starts the app on demand through the service
           file of the app, so no call needs an explicit start. */
        this._connection = Gio.DBus.session;
    }

    /**
     * Call one method of the app.
     * @param {string} method - The name of the method.
     * @param {GLib.Variant|null} parameters - The packed input arguments.
     * @returns {Promise<GLib.Variant>} The reply tuple.
     */
    _call(method, parameters = null) {
        return this._connection.call(
            SERVICE_NAME,
            OBJECT_PATH,
            INTERFACE_NAME,
            method,
            parameters,
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null);
    }

    /**
     * Run one command of the engine.
     * @param {string[]} argv - Arguments of the command.
     * @returns {Promise<{ok: boolean, code: number, stdout: string, stderr: string}>} The result.
     */
    async Run(argv) {
        try {
            const reply = await this._call('Run', new GLib.Variant('(as)', [Array.from(argv, String)]));
            const [ok, code, stdout, stderr] = reply.deepUnpack();
            return {ok, code, stdout, stderr};
        } catch (error) {
            return {ok: false, code: -1, stdout: '', stderr: messageOf(error)};
        }
    }

    /** @returns {Promise<object>} The whole state of the menu. */
    async GetState() {
        const reply = await this._call('GetState');
        const [
            running, previewRunning, rotation, camera, micOn, mirrorOn,
            device, phone, pipeWireSource, problems,
        ] = reply.deepUnpack();
        return {
            running, previewRunning, rotation, camera, micOn, mirrorOn,
            device, phone, pipeWireSource, problems,
        };
    }

    /** @returns {Promise<object>} `{ids, names}` of the cameras of the phone. */
    async GetCameras() {
        const reply = await this._call('GetCameras');
        const [ids, names] = reply.deepUnpack();
        return {ids, names};
    }

    /**
     * Open or close the preview window.
     * @param {boolean} start - True opens the window, false closes it.
     * @returns {Promise<{ok: boolean, error: string}>} The result.
     */
    async Preview(start) {
        const reply = await this._call(start ? 'StartPreview' : 'StopPreview');
        const [ok, error] = reply.deepUnpack();
        return {ok, error};
    }

    /** @returns {Promise<{ok: boolean, error: string}>} The result. */
    async RestartPipeWire() {
        const reply = await this._call('RestartPipeWire');
        const [ok, error] = reply.deepUnpack();
        return {ok, error};
    }

    /** @returns {Promise<{ok: boolean, error: string}>} The result. */
    async RunSetup() {
        const reply = await this._call('RunSetup');
        const [ok, error] = reply.deepUnpack();
        return {ok, error};
    }

    /** Let the next read ask the phone again. @returns {Promise<void>} */
    async ClearPhoneCache() {
        await this._call('ClearPhoneCache');
    }
}
