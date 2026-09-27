// SPDX-License-Identifier: GPL-3.0-or-later
// PhoneCam for GNOME Shell: the camera and the microphone of the phone as a
// webcam and a microphone of this computer.

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {PhoneCamIndicator} from './lib/indicator.js';

export default class PhoneCamExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new PhoneCamIndicator(this._settings, {
            openPreferences: () => this.openPreferences(),
            directory: this.dir,
        });
        // The widget is a row of the system menu (the quick settings menu of
        // the shell), not a panel button of its own.
        this._indicator.enable();
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
