# Requirement Specification: PhoneCam for GNOME Shell

Data module code: `OML-GNOME-REQ-0001`
Revision: 1
Date: 2026-09-27
Status: Released for implementation

## 1. Identification and scope

### 1.1 Subject

A GNOME Shell extension for GNOME Shell 50 and later. The extension shows the
PhoneCam camera stream as a row of the system menu (the quick settings menu) of
GNOME Shell and it controls that stream. A setting can also show an icon of the
widget in the top panel. The extension identifier is
`phonecam@kadir-gunel.github.io`. The extension lives in the
`gnome/` directory of this repository.

### 1.2 Purpose

The engine (`bin/phonecam`) is a command line program that does not use a
desktop environment. This specification covers the front-end for GNOME Shell
50 and later: it shows the state of the stream in the system menu, it can show
an icon of the widget in the top panel, and it sends the commands of the
engine.

### 1.3 In scope

- One row in the system menu: a `QuickSettings.QuickMenuToggle` that shows the
  state, and a click on it starts or stops the stream.
- An optional icon of the widget in the top panel, with the setting
  `show-panel-icon` (the default value is off).
- One drop-down menu with the state and with every command of the engine.
- A click on a menu row runs one command of the engine.
- The wheel over the row of the system menu, or over the icon of the panel,
  turns the picture (the wheel of the bar widget).
- One keyboard shortcut that starts and stops the stream (the optional
  keybinding of the manual).
- A preferences window: the path of the engine, the poll time, the icon of the
  panel, and the keyboard shortcut.
- A menu item that runs the setup of the virtual camera with the polkit
  dialog of GNOME.
- Tests: unit tests and a smoke test in a separate GNOME Shell instance.

### 1.4 Out of scope

- The engine. The extension runs `bin/phonecam` and does not copy its logic.
- The phone application, scrcpy, adb, and the kernel module v4l2loopback.
  The extension reports a missing item and shows the command for the fix.
- A change of the media pipeline.

## 2. Reference documents

| Reference | Document |
|---|---|
| R1 | `README.md` and `MANUAL.md` of this repository |
| R2 | `bin/phonecam` (the engine, with its own usage text) |
| R3 | `bin/phonecam-setup` and `setup-v4l2loopback.sh` (the setup of the module) |
| R4 | ASD-STE100 Simplified Technical English, issue 9 |
| R5 | The GNOME Shell 50 extension API (the modules of the shell) |

## 3. Definitions

| Term | Definition |
|---|---|
| Engine | The command `bin/phonecam` of this repository. |
| Stream | The scrcpy process that sends the camera of the phone to the v4l2loopback device and the microphone to the virtual source. |
| Settling | The time after a command until the engine reports the new state. |
| Device | The v4l2loopback video device with the card label `PhoneCam Camera`. |
| Problems | The items that stop the function: a missing device, a missing scrcpy or adb, and no phone in the adb state `device`. |

## 4. Requirements

### 4.1 The engine

| ID | Requirement |
|---|---|
| REQ-ENG-001 | The extension SHALL run the engine as a child process and SHALL NOT copy the logic of the engine. |
| REQ-ENG-002 | The extension SHALL start the engine with an argument list and SHALL NOT start a shell. |
| REQ-ENG-003 | The extension SHALL read the state of the stream with the command `is-running` (exit status only). |
| REQ-ENG-004 | The extension SHALL read the camera, the rotation, the mirror, and the microphone from the files that the engine writes in `$XDG_CONFIG_HOME/phonecam/`. The extension SHALL NOT write those files. |
| REQ-ENG-005 | The extension SHALL stop one engine command after 20 seconds. The exception is `start` (45 seconds, because it searches the phone) and a command that stops the stream and starts it again, that is `rotate`, `camera`, `mirror`, and `mic` (75 seconds). |
| REQ-ENG-006 | The extension SHALL keep a path setting for the engine. The default value SHALL be the engine next to the extension, then `phonecam` on the search path. |

### 4.2 Display

| ID | Requirement |
|---|---|
| REQ-DISP-001 | The widget SHALL be one `QuickSettings.SystemIndicator` with one `QuickSettings.QuickMenuToggle` in the system menu (the quick settings menu of GNOME Shell). The toggle SHALL show the symbolic icon `phone-symbolic` and the theme class `system-status-icon`. The optional icon of the panel SHALL show the same symbolic icon. The widget SHALL NOT show `camera-web-symbolic` or `camera-video-symbolic`: GNOME Shell shows the first icon in the panel while an application uses a camera, the theme draws both icons with equal pixels, and the user must tell the two icons apart. |
| REQ-DISP-002 | The toggle SHALL show the state: the `title` SHALL be `PhoneCam` and the `subtitle` SHALL be `streaming` or `stopped`, with `, <number> problems` when the engine reports a problem. The row SHALL be the widget in the system menu. The menu of the toggle SHALL hold the state line as its first row. |
| REQ-DISP-003 | The icon of the toggle SHALL use the attention colour of the theme while the stream runs, as the optional icon of the panel does (REQ-DISP-017 of the Basecamp Widget specification: `#ff7800` for the dark style, `#e01b24` for the light style). |
| REQ-DISP-004 | The menu of the toggle SHALL hold these rows in this order: the state, `Start the stream` or `Stop the stream`, the submenu `Turn the picture`, `Mirror`, `Microphone`, the submenu `Camera`, `Preview window`, the state of the phone, one row for each problem, `Set up the virtual camera`, and the footer rows `Refresh` and `Settings`. |
| REQ-DISP-005 | The submenu `Turn the picture` SHALL hold the values 0, 90, 180, and 270. The current value SHALL have the check ornament. |
| REQ-DISP-006 | The submenu `Camera` SHALL hold the camera ids of the phone with a short name: 0 main camera on the back, 1 front camera, 2 camera on the back with the largest sensor, and 3 camera on the back. The current value SHALL have the check ornament. |
| REQ-DISP-007 | The rows `Mirror` and `Microphone` SHALL be switch rows. The switch SHALL show the value from the engine. A change of the switch SHALL run the engine. |
| REQ-DISP-008 | The menu SHALL show a problem row with the exact command for the fix, or SHALL NOT show a problem row when no problem exists. The row of the phone SHALL hold the state of the phone: absent, `unauthorized`, or `offline`. |
| REQ-DISP-009 | The menu SHALL show the time of the last state read. |
| REQ-DISP-010 | The menu SHALL NOT be wider than 420 px. A long text SHALL end with "…". |
| REQ-DISP-011 | The icon of the widget in the panel SHALL be narrow, and it SHALL NOT take the 22 px of the theme: the rule `#panel .phonecam-panel-button` SHALL set `-natural-hpadding: 4px` and `-minimum-hpadding: 4px`, and the rule `#panel .phonecam-panel-button .system-status-icon` SHALL set `padding: 0 2px` and `margin: 0 2px`. The selector SHALL be at least as specific as the selector of the theme, because the shell can load the stylesheet of the theme after the stylesheet of the extension. The two panel icons of this project sit next to each other. Measured in the smoke test: the icon adds 28 px to the system menu button of the panel. |
| REQ-DISP-012 | The toggle SHALL show a small green light while the stream runs, to show the user that the camera is on. The light SHALL be a child of the icon box `phonecam-icon-box` and it SHALL sit over the lower right corner of the icon of the toggle. The light SHALL NOT widen that icon. The light SHALL hold the accessible name `The camera stream runs`, so a screen reader finds it. The light SHALL be visible in the state `streaming` and hidden in the state `stopped`. The layout `Clutter.BinLayout` SHALL honour the alignment of the light: the light SHALL set `x_expand: true` and `y_expand: true` with `x_align: Clutter.ActorAlign.END` and `y_align: Clutter.ActorAlign.END`, because the layout centres a child that does not expand. The rule `.phonecam-live-light` SHALL draw the light with the colour `#33d17a` in the two styles. |
| REQ-DISP-013 | The widget SHALL hold the boolean setting `show-panel-icon`. The default value SHALL be false: the widget then lives only in the system menu, and the panel SHALL hold no icon of the widget. A true value SHALL show the icon of the widget in the box of the system menu button, next to the other indicators of the panel. The widget SHALL apply a change of that setting without a shell restart. |

### 4.3 Actions

| ID | Requirement |
|---|---|
| REQ-ACT-001 | The row `Start the stream` SHALL run the engine with `start`. The row `Stop the stream` SHALL run the engine with `stop`. The menu SHALL show the row for the state that the engine does not have. A click on the toggle SHALL do the same as that row, and the `checked` state of the toggle SHALL be true while the stream runs. |
| REQ-ACT-002 | A value in the submenu `Turn the picture` SHALL run the engine with `rotate <value>`. |
| REQ-ACT-003 | A value in the submenu `Camera` SHALL run the engine with `camera <id>`. |
| REQ-ACT-004 | The switch `Mirror` SHALL run the engine with `mirror on` or `mirror off`. |
| REQ-ACT-005 | The switch `Microphone` SHALL run the engine with `mic on` or `mic off`. |
| REQ-ACT-006 | The row `Preview window` SHALL run the engine with `preview`. The preview is a child process of the extension. The same row SHALL close an open preview. The extension SHALL stop that child process at disable time. |
| REQ-ACT-007 | The row `Set up the virtual camera` SHALL run `bin/phonecam-setup`. That command SHALL use the polkit dialog of the session. |
| REQ-ACT-008 | The wheel over the toggle, or over the icon of the widget in the panel, SHALL run `cycle-rotation` (wheel up) or `prev-rotation` (wheel down). |
| REQ-ACT-009 | A keyboard shortcut SHALL run `start` or `stop`, in the same way as the first row of the menu. The shortcut SHALL exist only when the setting is not empty. |
| REQ-ACT-010 | The extension SHALL read the state again after each action. |
| REQ-ACT-011 | The menu SHALL close after an action with a visible result (start, stop, preview). |

### 4.4 State reads

| ID | Requirement |
|---|---|
| REQ-REFR-001 | The extension SHALL read the state at enable time and then after each `poll-interval` period. The default value of `poll-interval` is 5 seconds. |
| REQ-REFR-002 | The extension SHALL read the state each second for 12 seconds after an action, until the engine reports the new state. |
| REQ-REFR-003 | The extension SHALL read the state of the phone and the state of the device when the menu opens, and SHALL keep that result for 10 seconds. |
| REQ-REFR-004 | The extension SHALL NOT start a second read while a read runs. |
| REQ-REFR-005 | The extension SHALL stop the reads at disable time. |

### 4.5 Preferences

| ID | Requirement |
|---|---|
| REQ-PREF-001 | The preferences window SHALL use the GNOME `Adw` widgets. |
| REQ-PREF-002 | The preferences window SHALL hold these controls: the path of the engine, the poll interval in seconds (1 to 60), the switch `Show the icon in the panel` (REQ-DISP-013), and the keyboard shortcut. |
| REQ-PREF-003 | The extension SHALL apply each change without a shell restart. |

### 4.6 Portability and setup

| ID | Requirement |
|---|---|
| REQ-SET-001 | The installer SHALL put the engine, the setup command, the module setup script, and the configuration files of the module into the directory of the extension, so that the extension is self-contained. |
| REQ-SET-002 | The command `bin/phonecam-setup` SHALL use `pkexec` when `pkexec` is available, and it SHALL use a terminal with `sudo` only when `pkexec` is not available. |
| REQ-SET-003 | The script `setup-v4l2loopback.sh` SHALL also work when the kernel package holds the module and no sources exist in `/usr/src`. It SHALL install the configuration and load the module in that case. |
| REQ-SET-004 | The extension SHALL NOT install packages. It SHALL show the exact package command in the problem row. |
| REQ-SET-005 | The command `bin/phonecam-setup` SHALL install a copy of the module script and of the two configuration files of `etc/` with the owner root in `/usr/local/lib/phonecam/` before it asks for the password, and it SHALL run that copy with `sudo` or with `pkexec`. It SHALL NOT give a file of the extension directory to `sudo` or to `pkexec`. The reason is the guideline of extensions.gnome.org: a subprocess with the rights of root MUST run with `pkexec`, and it MUST NOT be a script that a process of the user can change. |

### 4.7 Quality and safety

| ID | Requirement |
|---|---|
| REQ-QA-001 | The extension SHALL NOT block the shell. Every call of the engine SHALL be asynchronous. |
| REQ-QA-002 | The extension SHALL remove all timers, child processes, menus, and signal handlers at disable time. |
| REQ-QA-003 | The extension SHALL NOT read or write a credential. It reads configuration files of the engine only. |
| REQ-QA-004 | The extension SHALL NOT start `pacman` or another package manager. |
| REQ-QA-005 | The extension SHALL keep all state in memory for the session. It SHALL write no file of its own. |
| REQ-QA-006 | The repository SHALL hold no credential, no token, no private network name or address of the user, and no personal path. A test script SHALL check the tree and the messages of the commits against these rules. |

## 5. The controls of the front-end

| Control | Result |
|---|---|
| Click on the toggle in the system menu | Starts or stops the stream |
| Click on the arrow of the toggle | Opens the menu of the widget |
| Row `Start the stream` / `Stop the stream` | Starts or stops the stream |
| Row `Turn the picture` | Sets the rotation to 0, 90, 180, or 270 |
| Row `Mirror`, row `Microphone` | Switches the value, and starts the stream again |
| Row `Camera` | Selects one of the cameras of the phone |
| Row `Preview window` | Opens or closes the picture in a window |
| Row `Restart PipeWire` | Lets PipeWire find the camera, for portal applications |
| Row `Set up the virtual camera` | Builds the kernel module |
| Wheel over the toggle, or over the icon of the panel | Next or previous rotation |
| Keyboard shortcut | Starts or stops the stream |

A click on a row of the system menu carries the action of the toggle: it starts
or stops the stream. The other actions are rows of the menu of the widget.

## 6. Verification

| ID | Requirement | Verification method |
|---|---|---|
| VER-001 | REQ-ENG-001 to REQ-ENG-006, REQ-ACT-001 to REQ-ACT-005 | Unit test of the argument builder and of the read of the configuration files. |
| VER-002 | REQ-DISP-001 to REQ-DISP-010, REQ-DISP-013, REQ-ACT-008 | Live test in a separate GNOME Shell instance with a test engine (the smoke test). The test reads the row of the widget in the system menu, its menu, and the optional icon of the panel through the accessibility interface, and it reads the presence of the icon in the panel with the D-Bus call `org.gnome.Shell.Eval` (the shell runs with `--unsafe-mode`). |
| VER-003 | REQ-ACT-006, REQ-ACT-007, REQ-QA-002 | The smoke test counts the child processes and the timers after `disable()`. |
| VER-004 | REQ-SET-003 | Test with the module of the kernel package and without sources in `/usr/src` (this workstation). |
| VER-005 | REQ-REFR-001 to REQ-REFR-005 | The smoke test reads the record of the calls of the test engine. |
| VER-006 | REQ-QA-001, REQ-QA-004 | Code review and the record of the calls. |
| VER-007 | REQ-SET-005 | The smoke test runs the setup command of the widget with a test `pkexec` that records the argument list: the three calls of `/usr/bin/install` come first, the last call names the module script of the root-owned copy, and no call names the module script of the extension directory. The test writes no file under `/usr/local`. The test runs the command and not the menu row, because this workstation has no program for a synthetic click (CON-003). |
| VER-008 | REQ-QA-006 | The scan `tools/secret-scan.sh`, which `tests/test-engine.sh` and `gnome/tools/test.sh` run before their tests. It reads the files of the tree and the messages of the commits, and it fails on a credential value, a JSON web token, a private key, a token of a service, the name of a private network, a personal path, and an address that is not in its allow-list. It prints the file and the line, or the hash of the commit, and never the value that it found. |


## 7. Constraints and limits

| ID | Constraint |
|---|---|
| CON-001 | This workstation has no `scrcpy` and no `adb`. A stream cannot run here. The extension shows the problem rows in that case, and the smoke test uses a test engine. |
| CON-002 | The module `v4l2loopback` is available in the kernel package `linux-cachyos`, but it is not loaded and no `/dev/video*` exists. `setup-v4l2loopback.sh` needs a change (REQ-SET-003). |
| CON-003 | The workstation has no program for the synthesis of pointer events. A click and a wheel turn cannot be automated. The smoke test opens the system menu with the D-Bus call `org.gnome.Shell.Eval` (the shell runs with `--unsafe-mode`) and it reads the row of the widget, its menu, and the optional icon of the panel through the accessibility interface; the unit tests cover the command of each action. See the same constraint in the Basecamp Widget specification. |
| CON-004 | The polkit dialog of `pkexec` needs a user action. The smoke test uses a test `pkexec` that records the argument list. |
| CON-005 | The engine takes the path of its configuration files from its own environment. The extension does not change that path, so an action from the menu and a command from a terminal have the same result. |

## 8. Missing information

| ID | Open item | Effect if the answer is "yes" |
|---|---|---|
| MIS-001 | Does the user want the sizes of the picture (`PHONECAM_SIZE`, `PHONECAM_FPS`, `PHONECAM_BITRATE`) in the preferences window? | The extension passes environment values to the engine. A command from a terminal then differs from a command from the menu. |
| MIS-002 | Does the user want the stream to start at login? | The extension needs an autostart entry and a delay until the phone answers. |
| MIS-003 | Does the user want more than one phone? | The extension needs a list of serial numbers for `adb -s`. |
| MIS-004 | Does the user want the extension to install the packages `scrcpy` and `android-tools`? | The extension needs `pkexec pacman`, and the menu row becomes an action. |
| MIS-005 | Does the user want a second microphone source with the voice presets? | The engine needs the value `PHONECAM_MIC_SOURCE` in the preferences window. |
| MIS-006 | Does the user want the preview window to stay above the other windows? | The extension needs a window rule or a different preview program. |
| MIS-007 | Does the user want a keyboard shortcut for the rotation as well? | The extension needs a second shortcut setting. |
| MIS-008 | The names in the submenu `Camera` describe the cameras of a OnePlus 5, because the engine documents that phone. The phone of the user is another model. Does the user want the list of the cameras from the phone instead? | The extension reads `phonecam camera` (or `scrcpy --list-cameras`) when the menu opens. The list then needs the phone to be connected, and the menu is longer. |

## 9. Release record

| Revision | Date | Change |
|---|---|---|
| 15 | 2026-09-30 | Request of the user: the same guard as the sibling projects. The repository now holds `tools/secret-scan.sh` (REQ-QA-006, VER-008). It fails on a credential value, on a JSON web token, on a private key, on a token of a service, on the name of a private network, on a personal path, and on an address that is not in its allow-list of the public addresses that this project needs (`github.com`, `gnome.org`, `w3.org`, `fsf.org`, `gnu.org`, and `example.com`). It reads the files of the tree and the messages of the commits; it prints the file and the line, or the hash of a commit, and it never prints the value that it found. `tests/test-engine.sh` and `gnome/tools/test.sh` run it before their tests. `.gitignore` names the credential file of the Fizzy CLI (`.fizzy.yaml`), so a token of that program cannot enter this repository. Measured: the scan reports no fault in the tree and none in the history; the engine tests stay at 8 of 8 and the unit tests at 108 of 108. |
| 14 | 2026-09-27 | Request of the user: the widget SHALL be a row of the system menu and not an icon of its own in the panel. Solution: `lib/indicator.js` now builds a `QuickSettings.SystemIndicator` with one `QuickSettings.QuickMenuToggle`. The `title` is `PhoneCam`, the `subtitle` is the state (`streaming` or `stopped`, with the number of problems), the `iconName` is `phone-symbolic`, and `checked` is true while the stream runs. A click on the toggle starts or stops the stream, as the first row of the menu does. The menu of the toggle holds the whole menu of the widget, and every row is unchanged, so REQ-DISP-004 to REQ-DISP-010 stay true. `Main.panel.statusArea.quickSettings.addExternalIndicator()` registers the indicator and the row. The new setting `show-panel-icon` (boolean, default false) puts the icon of the widget into the box of the system menu button; the preferences window holds a switch row for it (REQ-DISP-013, REQ-PREF-002). The light of the running stream moved from the panel button to the icon of the toggle (REQ-DISP-012). The two narrow rules of the stylesheet now name the class of the widget (`#panel .phonecam-panel-button`), because the widget is no longer a panel button of its own; the declarations are unchanged. `disable()` takes the widget, the menu of the toggle, the timers, and the child processes out, as before. Measured in the smoke test in a separate GNOME Shell 50.5: the widget is a `toggle button` with the accessible name `PhoneCam: stopped` at 1399,227 176x48 in the system menu (the test opened the menu with `org.gnome.Shell.Eval`, and the shell runs with `--unsafe-mode`); with the default setting the panel holds no icon of the widget; with `show-panel-icon` true the panel holds the icon at 1452,0 24x32, and the system menu button of the panel grows from 132 px to 160 px, so the icon adds 28 px (REQ-DISP-011). The light keeps the accessible name `The camera stream runs`. The smoke test now opens the system menu, reads the row of the widget in it, and reads the icon of the panel in both states of the setting. |
| 13 | 2026-09-27 | Review of the site for version 1 (the review page 75604, the extension 11075). The automatic check Shexli reported two findings and both were correct. (a) `EGO-X-004`: `lib/service.js` read the configuration files of the engine with `GLib.file_get_contents`, which blocks the main loop of the shell and breaks REQ-QA-001. The read is asynchronous now, and the package promisifies `Gio.File.load_contents_async` at construction, because the shell does not promisify it: a plain call answers "At least 2 arguments required", and the call resolves with the contents and the etag (both measured with gjs). (b) `EGO-P-006`: the package held `schemas/gschemas.compiled`, which the guidelines forbid for GNOME 45 and later. `tools/pack.sh` no longer compiles the schema, so the package holds the XML only and the build of the site compiles it; `tools/install.sh` still compiles it for a local installation. Verified: 106 unit checks, the smoke test, and the package of version 2 without the compiled schema. |
| 12 | 2026-09-27 | Review for the release on extensions.gnome.org. Finding (a): the guidelines mark the key `version` of `metadata.json` as deprecated and as set by the site; the key is gone from the metadata of both projects. Finding (b): the guidelines say that an extension MUST NOT hold copyrighted or trademarked content without the proof of the express permission of the owner; this project holds none, because its icon comes from the icon theme. Finding (c): the guidelines discourage external scripts and ask for GJS unless the use is necessary. The owner decided to submit the extension with the engine inside the package and to explain the reason in the note for the reviewer: the engine is also a standalone command line program, and the external programs scrcpy, adb, ffmpeg, and v4l2loopback do the heavy work. `RELEASING.md` holds the note, the steps of the upload, and the version rule. The identifier `phonecam@kadir-gunel.github.io` is free on the site: measured with the API of the site on 2026-09-27 (`/api/v1/extensions/?uuid=` answers 0), with the control of a published identifier that answers 1 and of an invented identifier that answers 0. The upload page sends a visitor without a session to the login page, so the release needs the account of the owner. |

| 11 | 2026-09-27 | Finding of the review of extensions.gnome.org, section "Privileged Subprocess must not be user-writable": the command `bin/phonecam-setup` gave the module script of the extension directory to `pkexec`, and a process of the user can change that file. Solution: the command compares the module script and the two configuration files of `etc/` with a copy under `/usr/local/lib/phonecam/`, and it installs the copy with `/usr/bin/install -D -o root -g root` when a file differs or the copy is absent. Then it runs the copy with `sudo` or with `pkexec`, and it never gives a file of the extension directory to the root part (REQ-SET-005, VER-007). The copy holds `etc/` beside the module script, and the script reads its configuration there, so the copy is complete. The two ways to ask for the password keep the same steps: the install runs first, and then the root part runs. The smoke test runs the setup command of the widget with a test `pkexec` that records the argument list, and it fails when the root part runs the user-writable script. Measured on this workstation: the recorded list holds the three calls of `/usr/bin/install` and then `/usr/local/lib/phonecam/setup-v4l2loopback.sh`, the test writes no file under `/usr/local`, and the same test with the old command fails with "the root part ran the user-writable script". MIS-004 of section 8 asks a different question (the installation of the packages `scrcpy` and `android-tools` by the extension), so it stays open. |
| 10 | 2026-09-27 | Decision of the owner of the project: the holder of the copyright is written `kadir-gunel(kadir-guenel)`, because the history holds the two spellings of the name. The README holds that form. The identifier of the extension is not a copyright notice and stays `phonecam@kadir-gunel.github.io`, because a change of the identifier would break every installation. |
| 9 | 2026-09-27 | Decision of the owner of the project: both projects use the GPL-3.0-or-later. The MIT license is replaced: `LICENSE` holds the text of the GNU General Public License version 3, every file that held `SPDX-License-Identifier: MIT` holds `GPL-3.0-or-later`, and the README tells the license, the reason, and the holder of the copyright. The change is possible because the owner holds the copyright of every file of the tree, and the tree holds no code of a third party. A copy that a user took under the MIT license keeps that license, because a given copy stays given.  The row of the first release was missing from this record; it is in the table again.|
| 8 | 2026-09-27 | Review of the license before a publication. Result: the project is conform in substance: `LICENSE` holds the MIT license, the source files of the widget and of the tools held the identifier `SPDX-License-Identifier: GPL-3.0-or-later`, the project copies no code of a third party, and the runtime packages (scrcpy, android-tools, v4l2loopback, ffmpeg, PipeWire) stand as requirements and are not distributed. The engine `bin/phonecam`, the repair command `bin/phonecam-setup`, the module script `setup-v4l2loopback.sh`, the two files of `etc/`, and the schema file did not hold the identifier. They hold it now. The MIT license is compatible with the GPL-2.0-or-later of GNOME Shell, whose modules the widget imports. Open item for the owner of the project: the holder of the copyright is `kadir-guenel` in `LICENSE` and `kadir-gunel` in the commits and in the remote. |
| 7 | 2026-09-27 | Request of the user: show that the camera is on, with a small green light on the panel icon. Solution: the panel icon sits in a bin-layout box (`phonecam-icon-box`), and a small green widget (`phonecam-live-light`, `#33d17a`) sits over its lower right corner (REQ-DISP-012). The light holds the accessible name `The camera stream runs`, and it is visible only while the stream runs. `Clutter.BinLayout` honours the alignment of a child only when that child expands, and it centres a child that does not expand, so the light sets `x_expand` and `y_expand` together with the two end alignments: without the two flags the light sat in the centre of the icon. Measured in the accessibility tree of a separate GNOME Shell with the test engine (extents from the accessibility interface): the panel button is 32x32 px in the two states, thus the light adds no width, and the light is 7x7 px over the lower right corner of the icon box (the box at 1468,0 24x32 and the light at 1485,25). The state set of the light actor is empty in the state `stopped`, and it holds `FOCUSABLE, SHOWING, VISIBLE` in the state `streaming`. The accessibility checker of the smoke test requires the visible light in the state `streaming` and forbids it in the state `stopped`. |
| 6 | 2026-09-27 | Report of the user: the space between the Basecamp icon and the PhoneCam icon in the panel is too large. Measurement in a separate GNOME Shell with both extensions enabled: each panel button was 60 px wide, thus each side reserved 22 px. The cause is the theme and not the extensions: `#panel .panel-button` asks for `-natural-hpadding: 12px` and `#panel .panel-button .system-status-icon` asks for `padding: 0 6px` and `margin: 0 4px`. Solution: each extension gives its panel button its own class (`phonecam-panel-button`, `basecamp-panel-button`) and overrides those values (REQ-DISP-011 here and REQ-DISP-018 of the Basecamp Widget specification). Measured after the change: each panel button is 32 px wide, the two buttons touch, and the buttons of the shell keep their size (the System button stays 104 px wide). Finding during the tests of this change: the smoke test failed one time with `the menu does not hold the time of the last read`, then passed two times on the same code. The cause is in the checker and not in the widget: the widget reads the state of the engine without a wait, and the checker read the tree before the answer arrived, so the footer still held `Not read yet`. `gnome/tools/a11y-tree.py` now waits up to 20 seconds for the row `Updated …` before the check. A row that never appears still fails the check. Four runs of the smoke test on the two versions of the widget (two with the change, two without it) show that the failure does not come from this change: the two runs with the change passed, and one of the two runs without the change failed in the same way. |
| 5 | 2026-09-27 | The user chose the name PhoneCam. The project, the command, the state directory, the environment variables, the audio nodes, and the GNOME identifier changed. The two labels are `PhoneCam Camera` in the camera list and `PhoneCam` in the microphone list: a space cannot survive in the microphone label, because pipewire-pulse cuts a value of a module property at the first space (six forms tested, and a PipeWire rule did not apply). The extension identifier is `phonecam@kadir-gunel.github.io`, because the review guidelines of extensions.gnome.org forbid `gnome.org` as the namespace and ask for a registered domain or an account such as `username.github.io`. Measured after the change on the workstation of the user: the kernel module reports the device `PhoneCam Camera`, the stream runs, the widget reads the state with no problem row, the test of the engine passes 8 of 8 checks, the unit tests pass 99 of 99, and the smoke test passes. |
| 4 | 2026-09-27 | Two reports of the user: the rotation does nothing while the stream runs, and the picture of the menu must not move under the pointer. (a) The cause of the first report is in the engine: the state of the stream came from the pid file only, and that file can be absent while scrcpy runs, so `rotate`, `camera`, `mirror`, and `mic` took the way "no camera stream runs" and wrote their value without a new stream. The engine now finds the process of scrcpy as a second source of the state and writes the pid file again (see MANUAL.md, section 8, and `tests/test-engine.sh`). Measured on the workstation of the user: a rotation with the stream running needs 4.3 seconds, and the state is correct after that. (b) The widget read the state each second for 12 seconds after an action and it built the menu again at each read, so a submenu closed under the pointer. The widget now builds the menu again only when the plan or the error list changed, and the time limit of a command that stops and starts the stream is 75 seconds (REQ-ENG-005). |
| 3 | 2026-09-27 | Finding after the packages `scrcpy` and `android-tools` arrived. `adb get-state` reports a phone that awaits the answer of the user on the *error* output ("device unauthorized"), so the state was "unknown". The widget now reads the state from both outputs and shows one row per state: `unauthorized` ("The phone waits for the USB-debugging answer"), `offline`, and absent. Verified on this workstation: the widget reports one problem (the answer of the phone), the module takes the branch of the kernel package and reports `/dev/video10`, and `bin/phonecam start` stops at the phone with its own message. |
| 2 | 2026-09-27 | Findings during the implementation and the tests. (a) The menu did not show the time of the last read, although the plan of the menu held it. The smoke test found this. (b) A switch row appears in the accessibility interface as a `check menu item` with a `check box`, so the test reads the value from the box. (c) The two shared scripts of the engine changed for GNOME: `bin/phonecam-setup` asks for the password with the polkit dialog when no terminal exists, and `setup-v4l2loopback.sh` also works when the kernel package holds the module and no sources exist in `/usr/src` (REQ-SET-002, REQ-SET-003). (d) The installer copies the engine, the setup command, the module script, and the configuration of the module into the directory of the extension, so the extension is self-contained (REQ-SET-001). |
| 1 | 2026-09-27 | First release: a front-end for GNOME Shell 50 and later. |
