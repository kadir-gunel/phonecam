// SPDX-License-Identifier: MIT
// PhoneCam for GNOME Shell: the camera and the microphone of the phone as a
// webcam and a microphone of this computer.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {PhoneCamIndicator} from './lib/indicator.js';

export default class PhoneCamExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new PhoneCamIndicator(this._settings, {
            openPreferences: () => this.openPreferences(),
            directory: this.dir,
        });
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
