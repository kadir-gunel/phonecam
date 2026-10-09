// SPDX-License-Identifier: GPL-3.0-or-later
// State reads and actions for the PhoneCam panel widget.
//
// The PhoneCam app holds the engine and does the work. This module is the
// front-end of the widget: it reads the state of the app and it sends the
// commands of the menu, both over the session D-Bus.

import {DBusClient, messageOf} from './dbus-client.js';

/** Time of the faster read after an action, in seconds. */
export const SETTLING_SECONDS = 12;

/** The state of a widget whose app did not answer. */
const FALLBACK_STATE = Object.freeze({
    running: false, rotation: '0', camera: '1', micOn: true, mirrorOn: false,
});

export class PhoneCamService {
    constructor() {
        this._client = new DBusClient();
        this._previewRunning = false;
    }

    /** @returns {boolean} True while the preview window runs. */
    get previewRunning() {
        return this._previewRunning;
    }

    /* The engine lives in the app, so the two settings of the widget have no
       effect. The methods stay, because the widget applies its settings. */

    /** @param {string} _engine - The setting of the widget. @returns {null} */
    setEngine(_engine) {
        return null;
    }

    /** @param {string} _setup - The setting of the widget. @returns {null} */
    setSetup(_setup) {
        return null;
    }

    /**
     * Read the whole state of the widget.
     * @returns {Promise<object>} `{state, problems, device, phone, pipeWireSource}`.
     */
    async read() {
        try {
            const result = await this._client.GetState();
            this._previewRunning = result.previewRunning === true;
            return {
                state: {
                    running: result.running === true,
                    rotation: result.rotation,
                    camera: result.camera,
                    micOn: result.micOn === true,
                    mirrorOn: result.mirrorOn === true,
                },
                problems: (result.problems ?? []).map(([title, hint]) => ({title, hint})),
                device: result.device === '' ? null : result.device,
                phone: result.phone === '' ? undefined : result.phone,
                pipeWireSource: result.pipeWireSource === true,
            };
        } catch (error) {
            return {
                state: {...FALLBACK_STATE},
                problems: [{title: 'The PhoneCam app did not answer',
                    hint: messageOf(error)}],
                device: null,
                phone: undefined,
                pipeWireSource: true,
            };
        }
    }

    /**
     * Run one command of the engine.
     * @param {string[]} argv - Arguments of the command.
     * @returns {Promise<object>} `{ok, code, stdout, stderr}`.
     */
    async run(argv) {
        return this._client.Run(argv);
    }

    /** Open the preview window. @returns {Promise<object>} `{ok, stdout, stderr}`. */
    async startPreview() {
        const result = await this._client.Preview(true);
        if (result.ok)
            this._previewRunning = true;
        return {ok: result.ok, stdout: '', stderr: result.error ?? ''};
    }

    /** Close the preview window. @returns {Promise<object>} `{ok, stdout, stderr}`. */
    async stopPreview() {
        const result = await this._client.Preview(false);
        if (result.ok)
            this._previewRunning = false;
        return {ok: result.ok, stdout: '', stderr: result.error ?? ''};
    }

    /** @returns {Promise<object>} `{ok, stdout, stderr}`. */
    async restartPipeWire() {
        const result = await this._client.RestartPipeWire();
        return {ok: result.ok, stdout: '', stderr: result.error ?? ''};
    }

    /** @returns {Promise<object>} `{ok, stdout, stderr}`. */
    async runSetup() {
        const result = await this._client.RunSetup();
        return {ok: result.ok, stdout: '', stderr: result.error ?? ''};
    }

    /** Let the next read ask the phone again, for the open menu. */
    clearPhoneCache() {
        this._client.ClearPhoneCache().catch(() => {});
    }

    /** The app keeps the state, so only the client comes out. */
    destroy() {
        this._client = null;
        this._previewRunning = false;
    }
}
