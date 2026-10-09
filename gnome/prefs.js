// SPDX-License-Identifier: GPL-3.0-or-later
// Preferences window of PhoneCam for GNOME Shell.

import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class PhoneCamPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'PhoneCam',
            icon_name: 'phone-symbolic',
        });

        const behaviourGroup = new Adw.PreferencesGroup({title: 'Behaviour'});
        const pollRow = new Adw.SpinRow({
            title: 'Read the state every',
            subtitle: 'Seconds between two reads. After an action the widget reads each second ' +
                'for 12 seconds.',
            adjustment: new Gtk.Adjustment({lower: 1, upper: 60, step_increment: 1, page_increment: 5}),
        });
        settings.bind('poll-interval', pollRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        behaviourGroup.add(pollRow);

        const panelRow = new Adw.SwitchRow({
            title: 'Show the icon in the panel',
            subtitle: 'The widget then sits in the panel and in the system menu. ' +
                'The default is the system menu only.',
        });
        settings.bind('show-panel-icon', panelRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        behaviourGroup.add(panelRow);

        behaviourGroup.add(this._shortcutRow(settings));
        page.add(behaviourGroup);

        window.add(page);
        window.search_enabled = true;
        window.set_default_size(560, 520);
    }

    /**
     * The shortcut lives in an array, so a plain binding is not possible:
     * an empty text clears the setting, a valid accelerator sets one value.
     */
    _shortcutRow(settings) {
        const row = new Adw.EntryRow({title: 'Keyboard shortcut (for example <Super><Shift>o)'});
        row.text = settings.get_strv('toggle-shortcut')[0] ?? '';

        const apply = () => {
            const text = row.text.trim();
            if (text === '') {
                row.remove_css_class('error');
                settings.set_strv('toggle-shortcut', []);
                return;
            }
            const [, keyval, modifiers] = Gtk.accelerator_parse(text);
            const valid = Gtk.accelerator_valid(keyval, modifiers);
            if (valid) {
                row.remove_css_class('error');
                settings.set_strv('toggle-shortcut', [text]);
            } else {
                row.add_css_class('error');
            }
        };

        row.connect('changed', apply);
        settings.connect('changed::toggle-shortcut', () => {
            const value = settings.get_strv('toggle-shortcut')[0] ?? '';
            if (row.text !== value)
                row.text = value;
        });
        row.set_tooltip_text('An empty value means no shortcut. The value must be an ' +
            'accelerator, for example <Super><Shift>o. ' +
            `Available keys: ${String(Gdk.KEY_o)}`);
        return row;
    }
}
