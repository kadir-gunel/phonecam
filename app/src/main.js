// SPDX-License-Identifier: GPL-3.0-or-later
// The entry point of the PhoneCam app.
//
// It owns the name of the service on the session bus, it exports the object of
// the interface, and it runs until a signal or the loss of the name stops it.
// The session bus starts it on demand from
// io.github.kadir_gunel.PhoneCam.service; the launcher may also start it.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GLibUnix from 'gi://GLibUnix';

import {PhoneCamService, SERVICE_NAME, OBJECT_PATH, interfaceXml} from './phonecam-service.js';

/** SIGTERM and SIGINT: a clean end, so that the preview window closes too. */
const STOP_SIGNALS = [15, 2];

const loop = new GLib.MainLoop(null, false);
let service = null;
let exported = null;
let nameId = 0;
let stopping = false;

/** Close the preview window, release the name, and leave the main loop. */
function stop() {
    if (stopping)
        return;
    stopping = true;
    for (const id of signalIds) {
        if (id !== 0)
            GLib.source_remove(id);
    }
    service?.destroy();
    exported?.unexport();
    if (nameId !== 0) {
        Gio.bus_unown_name(nameId);
        nameId = 0;
    }
    loop.quit();
}

const signalIds = STOP_SIGNALS.map(signal => GLibUnix.signal_add(GLib.PRIORITY_DEFAULT, signal, () => {
    stop();
    return GLib.SOURCE_REMOVE;
}));

// The interface sits beside this module. Without it the app cannot serve the
// front-end at all, so a blunt failure is better than a service that answers
// nothing.
const xml = interfaceXml();

nameId = Gio.bus_own_name(
    Gio.BusType.SESSION,
    SERVICE_NAME,
    Gio.BusNameOwnerFlags.NONE,
    connection => {
        service = new PhoneCamService();
        exported = Gio.DBusExportedObject.wrapJSObject(xml, service);
        service.setExportedObject(exported);
        exported.export(connection, OBJECT_PATH);
    },
    null,
    () => {
        if (stopping)
            return;
        printerr(`PhoneCam: the name ${SERVICE_NAME} is not available`);
        stop();
    });

// The name can be lost before the main loop starts: another instance owns it.
// Then `stop()` has already asked the loop to end, and the app must not run it.
if (!stopping)
    loop.run();
