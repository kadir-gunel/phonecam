// SPDX-License-Identifier: MIT
// Tests for the PhoneCam panel widget. Run with tools/test.sh.

import GLib from 'gi://GLib';
import System from 'system';

import {
    ProcessRunner, cameraArgv, isRunningArgv, micArgv, mirrorArgv, nextRotationArgv,
    previewArgv, previousRotationArgv, resolveProgram, rotateArgv, startArgv, statusArgv, stopArgv,
    timeoutFor,
} from '../lib/cli.js';
import * as state from '../lib/state.js';

const failures = [];
let checks = 0;

function check(name, condition, detail = '') {
    checks++;
    if (!condition)
        failures.push(`${name}${detail ? ` (${detail})` : ''}`);
}

function equal(name, actual, expected) {
    check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// --- Commands ---------------------------------------------------------------
equal('start', startArgv().join(' '), 'start');
equal('stop', stopArgv().join(' '), 'stop');
equal('status', statusArgv().join(' '), 'status');
equal('is-running', isRunningArgv().join(' '), 'is-running');
equal('rotate', rotateArgv('90').join(' '), 'rotate 90');
equal('rotate keeps a number', rotateArgv(180).join(' '), 'rotate 180');
equal('next rotation', nextRotationArgv().join(' '), 'cycle-rotation');
equal('previous rotation', previousRotationArgv().join(' '), 'prev-rotation');
equal('camera', cameraArgv('2').join(' '), 'camera 2');
equal('mirror on', mirrorArgv(true).join(' '), 'mirror on');
equal('mirror off', mirrorArgv(false).join(' '), 'mirror off');
equal('microphone on', micArgv(true).join(' '), 'mic on');
equal('microphone off', micArgv(false).join(' '), 'mic off');
equal('preview', previewArgv().join(' '), 'preview');

// --- Time limits ------------------------------------------------------------
equal('a read has 20 seconds', timeoutFor(isRunningArgv()), 20);
equal('status has 20 seconds', timeoutFor(statusArgv()), 20);
equal('stop has 20 seconds', timeoutFor(stopArgv()), 20);
equal('start has 45 seconds, because it searches the phone', timeoutFor(startArgv()), 45);
equal('a rotation has 75 seconds, because it stops and starts the stream',
    timeoutFor(rotateArgv('90')), 75);
equal('a camera change has 75 seconds', timeoutFor(cameraArgv('2')), 75);
equal('a mirror change has 75 seconds', timeoutFor(mirrorArgv(true)), 75);
equal('a microphone change has 75 seconds', timeoutFor(micArgv(false)), 75);
equal('an unknown command has the normal limit', timeoutFor(['no-such-verb']), 20);
equal('an empty command has the normal limit', timeoutFor([]), 20);

// --- Program lookup ---------------------------------------------------------
// The engine of this repository is two levels above the tests directory.
check('an absolute program is found',
    resolveProgram(`${GLib.get_current_dir()}/../../bin/phonecam`) !== null);
equal('a missing program gives null', resolveProgram('no-such-phonecam-command-xyz'), null);
equal('an empty value gives null', resolveProgram('   '), null);
check('sh is found on the path', resolveProgram('sh') !== null);

// --- Files of the engine ----------------------------------------------------
equal('a valid rotation', state.readValue('90\n', state.ROTATIONS, '0'), '90');
equal('a rotation with spaces', state.readValue('  180  \n', state.ROTATIONS, '0'), '180');
equal('a bad rotation gives the default', state.readValue('45', state.ROTATIONS, '0'), '0');
equal('a missing file gives the default', state.readValue(null, state.ROTATIONS, '0'), '0');
equal('an empty file gives the default', state.readValue('', state.ROTATIONS, '0'), '0');
equal('the first line counts', state.readValue('90\n180', state.ROTATIONS, '0'), '90');

const stopped = state.stateFromFiles({rotation: '90', camera: '2', mic: 'off', mirror: 'on'}, {running: false});
equal('state: rotation', stopped.rotation, '90');
equal('state: camera', stopped.camera, '2');
equal('state: microphone', stopped.micOn, false);
equal('state: mirror', stopped.mirrorOn, true);
equal('state: running', stopped.running, false);
equal('orientation with the mirror', state.orientationOf(stopped), 'flip90');
const defaults = state.stateFromFiles({}, {running: true});
equal('default rotation', defaults.rotation, '0');
equal('default camera', defaults.camera, '1');
equal('default microphone', defaults.micOn, true);
equal('default mirror', defaults.mirrorOn, false);
equal('orientation without the mirror', state.orientationOf(defaults), '0');
equal('a camera that is not a number', state.stateFromFiles({camera: 'front'}, {}).camera, '1');

// --- The device -------------------------------------------------------------
const devices = [
    {node: 'video0', name: 'Integrated Camera'},
    {node: 'video10', name: 'PhoneCam Camera'},
];
equal('the device of the card label', state.deviceNode(devices), '/dev/video10');
equal('no device with the label', state.deviceNode([{node: 'video0', name: 'Other'}]), null);
equal('an empty list', state.deviceNode([]), null);
equal('a list with an empty name', state.deviceNode([{node: 'video1', name: null}]), null);

// --- Problems ---------------------------------------------------------------
equal('no problem', state.problemsFor({
    engine: true, device: true, scrcpy: true, adb: true, phone: 'device',
}).length, 0);
const all = state.problemsFor({engine: false, device: false, scrcpy: false, adb: false, phone: 'unknown'});
equal('five problems', all.length, 5);
equal('the order of the problems', all.map(item => item.title).join(' | '),
    'The phonecam command was not found | The virtual camera is missing | ' +
    'scrcpy is not installed | adb is not installed | The phone is not connected');
equal('a hint of the problems', all[2].hint, 'pacman -S scrcpy');
equal('the phone without an answer is no problem', state.problemsFor({
    engine: true, device: true, scrcpy: true, adb: true,
}).length, 0);
equal('a ready phone is no problem', state.problemsFor({phone: 'device'}).length, 0);
equal('an unauthorized phone', state.phoneProblem('unauthorized').title,
    'The phone waits for the USB-debugging answer');
equal('an unauthorized phone, hint', state.phoneProblem('unauthorized').hint,
    'Unlock the phone and accept the question');
equal('an offline phone', state.phoneProblem('offline').title, 'The phone is offline');
equal('an unknown phone', state.phoneProblem('unknown').title, 'The phone is not connected');
equal('a missing adb is no phone problem', state.phoneProblem(undefined), null);

// --- The state line ---------------------------------------------------------
equal('the state line while the stream runs',
    state.statusLine(state.stateFromFiles({rotation: '90', camera: '1', mic: 'on', mirror: 'on'}, {running: true})),
    'Streaming · camera 1 · flip90 · microphone on');
equal('the state line while the stream is off',
    state.statusLine(state.stateFromFiles({}, {running: false})),
    'Stopped · camera 1 · 0 · microphone on');

// --- The rows of the portal case --------------------------------------------
const runningState = state.stateFromFiles({}, {running: true});
equal('no PipeWire row while the stream is stopped',
    state.pipeWireRow(state.stateFromFiles({}, {running: false}), {pipeWireSource: false}), null);
equal('no PipeWire row while PipeWire holds the camera',
    state.pipeWireRow(runningState, {pipeWireSource: true}), null);
const pipeWire = state.pipeWireRow(runningState, {pipeWireSource: false});
equal('the PipeWire row while the node is absent', pipeWire.label,
    'Restart PipeWire (for portal applications)');
equal('the action of the PipeWire row', pipeWire.action, 'restart-pipewire');
const portalPlan = state.planMenu(runningState, {pipeWireSource: false});
equal('the plan holds the PipeWire row', portalPlan.pipeWire.label,
    'Restart PipeWire (for portal applications)');
equal('the PipeWire row is no problem', portalPlan.problems.length, 0);
const quietPlan = state.planMenu(runningState, {pipeWireSource: true});
equal('no PipeWire row in the plan', quietPlan.pipeWire, null);

// --- The plan of the menu ---------------------------------------------------
const plan = state.planMenu(stopped, {
    problems: [{title: 'The virtual camera is missing', hint: 'Run "Set up the virtual camera"'}],
    phone: 'device',
    previewRunning: false,
    updatedAt: 'Updated 14:32',
});
equal('the head of the menu', `${plan.header.title} · ${plan.header.subtitle}`,
    'PhoneCam · Stopped · camera 2 · flip90 · microphone off');
equal('the toggle while stopped', plan.toggle.label, 'Start the stream');
equal('the command of the toggle', plan.toggle.argv.join(' '), 'start');
equal('the rotation values', plan.rotation.items.map(item => item.value).join(','), '0,90,180,270');
equal('the current rotation', plan.rotation.items.filter(item => item.current).map(item => item.value).join(','), '90');
equal('the command of a rotation', plan.rotation.items[2].argv.join(' '), 'rotate 180');
equal('the mirror switch', plan.mirror.active, true);
equal('the command of the mirror', plan.mirror.argvOff.join(' '), 'mirror off');
equal('the microphone switch', plan.microphone.active, false);
equal('the command of the microphone', plan.microphone.argvOn.join(' '), 'mic on');
equal('the camera list', plan.camera.items.map(item => item.id).join(','), '0,1,2,3');
equal('the current camera', plan.camera.items.filter(item => item.current).map(item => item.id).join(','), '2');
equal('the name of a camera', plan.camera.items[1].detail, 'front camera');
equal('the preview row', plan.preview.label, 'Preview window');
equal('the phone row', plan.phone.label, 'Phone: connected');
equal('the problem rows', plan.problems.length, 1);
equal('the setup row', plan.setup.title, 'Set up the virtual camera');
equal('the footer', plan.footer.updated, 'Updated 14:32');

const planRunning = state.planMenu(state.stateFromFiles({}, {running: true}), {phone: 'unauthorized'});
equal('the toggle while the stream runs', planRunning.toggle.label, 'Stop the stream');
equal('the command of the toggle while the stream runs', planRunning.toggle.argv.join(' '), 'stop');
equal('a phone that is not ready is no row', planRunning.phone, null);
equal('no problem rows by default', planRunning.problems.length, 0);
equal('the footer before the first read', planRunning.footer.updated, 'Not read yet');
const planPreview = state.planMenu(state.stateFromFiles({}, {}), {previewRunning: true});
equal('the preview row while the window is open', planPreview.preview.label, 'Preview window (open)');

// --- The live engine of this repository -------------------------------------
const engine = GLib.build_filenamev([GLib.get_current_dir(), '..', '..', 'bin', 'phonecam']);
if (GLib.file_test(engine, GLib.FileTest.IS_EXECUTABLE)) {
    const runner = new ProcessRunner(engine);
    const running = await runner.run(isRunningArgv(), {timeoutSeconds: 20});
    check('is-running gives an exit status', running.code === 0 || running.code === 1,
        `code ${running.code}, stderr ${running.stderr}`);
    const status = await runner.run(statusArgv(), {timeoutSeconds: 20});
    check('status answers', status.stdout.includes('phonecam:'), status.stdout.slice(0, 120));
    check('status reports the state', /phonecam: (not )?running/.test(status.stdout), status.stdout.slice(0, 120));
    const bad = await runner.run(['no-such-verb'], {timeoutSeconds: 20});
    check('an unknown verb is an error', bad.ok === false && bad.code === 1, `code ${bad.code}`);
} else {
    check('the engine is present', false, engine);
}

// --- Settings keys ----------------------------------------------------------
const schema = (() => {
    const [ok, bytes] = GLib.file_get_contents('../schemas/org.gnome.shell.extensions.phonecam.gschema.xml');
    if (!ok)
        throw new Error('Cannot read the schema');
    return new TextDecoder().decode(bytes);
})();
const schemaKeys = [...schema.matchAll(/<key name="([^"]+)"/g)].map(match => match[1]);
const usedKeys = new Set();
for (const file of ['../prefs.js', '../lib/indicator.js']) {
    const [ok, bytes] = GLib.file_get_contents(file);
    if (!ok)
        throw new Error(`Cannot read ${file}`);
    const source = new TextDecoder().decode(bytes);
    for (const match of source.matchAll(/(?:bind\(|get_string\(|get_uint\(|get_strv\()'([a-z-]+)'/g))
        usedKeys.add(match[1]);
    for (const match of source.matchAll(/changed::([a-z-]+)/g))
        usedKeys.add(match[1]);
}
usedKeys.delete('toggle-shortcut');
usedKeys.add('toggle-shortcut');
for (const key of usedKeys)
    check(`the schema holds the key ${key}`, schemaKeys.includes(key), schemaKeys.join(','));
for (const key of schemaKeys)
    check(`the key ${key} is used`, usedKeys.has(key), [...usedKeys].join(','));

// --- Result -----------------------------------------------------------------
for (const failure of failures)
    printerr(`FAIL ${failure}`);
print(`${checks - failures.length} of ${checks} checks passed`);
if (failures.length > 0)
    System.exit(1);
