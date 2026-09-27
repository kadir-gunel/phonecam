# PhoneCam for GNOME Shell

The GNOME Shell front-end of PhoneCam. It shows the camera stream in the top
panel and it starts and stops that stream. The engine is the command
`bin/phonecam` of this repository, so a command from the menu and a command
from a terminal have the same result.

Tested on GNOME Shell 50.5 (Wayland). The extension uses the API of GNOME
Shell 45 and later.

## Requirements

- GNOME Shell 50 or later.
- The packages of the engine:

  ```sh
  sudo pacman -S scrcpy android-tools ffmpeg v4l-utils
  ```

  `v4l-utils` holds `v4l2-ctl`, which the engine uses to find the video device.
  `pactl` comes with `libpulse`, `ffplay` with `ffmpeg`. Add `android-udev` only
  when `adb` does not see the phone, and `v4l2loopback-dkms` with `dkms` only
  when the kernel package does not hold the module `v4l2loopback` (the kernel
  `linux-cachyos` holds it).
- An Android phone with USB debugging, connected by USB.
- `gjs` 1.88 or later (part of GNOME Shell).

## Install

```sh
./tools/install.sh
```

The installer puts the extension in
`~/.local/share/gnome-shell/extensions/phonecam@kadir-gunel.github.io` and the engine, the
setup command, the module script, and the configuration of the module into the
same directory. The extension is self-contained.

Then:

1. Log out and log in again. GNOME Shell reads the list of extensions only at
   start.
2. Enable the widget:

   ```sh
   gnome-extensions enable phonecam@kadir-gunel.github.io
   ```

3. Build the virtual camera, from the menu row `Set up the virtual camera`.
   The command asks for your password with the polkit dialog of GNOME. It puts
   the root part in `/usr/local/lib/phonecam/` first, and then it runs that
   copy. A process of your user cannot change the copy.
4. Connect the phone, unlock it, and allow USB debugging.

## Use

A click on the panel icon opens the menu. The menu holds the state and every
command of the engine:

| Row | Result |
|---|---|
| Start the stream / Stop the stream | Starts or stops the camera stream. |
| Turn the picture | Sets the rotation to 0, 90, 180, or 270. |
| Mirror | Mirrors the picture. |
| Microphone | Switches the microphone of the phone on or off. |
| Camera | Selects one of the four cameras of the phone (1 is the front camera). |
| Preview window | Opens the picture in a window; the same row closes it. |
| Phone: connected | The phone answers on the adb interface. |
| One row per problem | A missing item, with the command for the fix. |
| Set up the virtual camera | Builds the module of the virtual camera (root). |

Two more controls:

- The wheel over the panel icon turns the picture, as the wheel of the bar
  widget does.
- A keyboard shortcut starts and stops the stream. Set it in the preferences
  (for example `<Super><Shift>o`). The value is empty at the start, so no
  shortcut is taken from another program.

While the stream runs, the panel icon takes the attention colour of the theme
(`#ff7800` in the dark style, `#e01b24` in the light style).

### Before an application looks for the camera

Start the stream first, and then select `PhoneCam Camera` in the application.
The video device reports the capture ability only while the stream runs, so an
application that opens its camera list before the start shows no camera.

An application that uses the camera portal of the desktop (the camera
application of GNOME, and the browsers on Wayland) gets the camera from
PipeWire, so PipeWire must have seen the device while the stream runs. The menu
has the row `Restart PipeWire (for portal applications)` for that; it appears
only while the stream runs and PipeWire holds no node of the camera. See
section 7 of [../MANUAL.md](../MANUAL.md).

### The controls

| Control | Result |
|---|---|
| Click on the panel icon | Opens the menu |
| Row `Start the stream` / `Stop the stream` | Starts or stops the stream |
| Wheel over the panel icon | Next or previous rotation |
| Keyboard shortcut | Starts or stops the stream |
| Row `Preview window` | Opens the picture in a window; the same row closes it |

The keyboard shortcut is empty at the start. Set it in the preferences, for
example to `<Super><Shift>o`.

### The two camera icons of the panel

GNOME Shell shows its own camera icon in the panel while an application uses a
camera. That icon is a privacy feature of GNOME and it is not a part of this
widget. The user cannot turn it off.

The widget shows an icon of a telephone instead, because the theme draws
`camera-web-symbolic` and `camera-video-symbolic` with equal pixels. Thus the
two icons are not equal. The widget icon takes the attention colour of the
theme while the stream runs.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| The phonecam command | the copy in the extension directory | The engine. |
| The setup command | the copy in the extension directory | The command of the menu row `Set up the virtual camera`. |
| Read the state every | 5 s | The poll time. After an action the widget reads each second for 12 seconds. |
| Keyboard shortcut | empty | Starts and stops the stream. |

## Tests

```sh
./tools/test.sh              # Unit tests. No shell, no phone, no module.
./tools/shell-smoke-test.sh  # The widget in a separate GNOME Shell.
```

The unit tests cover the commands, the read of the configuration files of the
engine, the list of problems, and the plan of the menu. They also run the real
engine of this repository for the commands that need no phone.

The smoke test starts a separate GNOME Shell with a private D-Bus session, a
private configuration, and a private extension directory. It puts a test
engine in place of `bin/phonecam` and test programs in place of `scrcpy` and
`adb`, so the test needs no phone and no kernel module. It reads the panel and
the menu through the accessibility interface, and it checks both states
(stopped and streaming), the problem rows, the switches, and the state line.
The test does not change the session of the user.

## Limits

- The submenu `Camera` names the four cameras as the engine documents them for
  a OnePlus 5. On another phone the numbers can mean other cameras. The
  command `bin/phonecam camera` shows the real list of the connected phone.

- A pointer click and a wheel turn cannot be automated on this workstation
  (no nested X11 shell, no program for the synthesis of pointer events). The
  unit tests cover the command of every action and the smoke test reads the
  whole menu; the wiring of the click itself needs a human hand.
- The metadata lists the version of GNOME Shell that was tested (`50`). For a
  later major version, add it to `shell-version` in `metadata.json`; the code
  uses the API of GNOME Shell 45 and later only.
- The widget reads and writes no file of its own except the settings. The
  state lives in the configuration files of the engine.

## Files

| Path | Content |
|---|---|
| `extension.js` | The entry point of the extension. |
| `lib/indicator.js` | The panel button, the menu, the wheel, and the shortcut. |
| `lib/service.js` | The state reads, the queue, and the child processes. |
| `lib/cli.js` | The commands of the engine. |
| `lib/state.js` | The state and the plan of the menu. |
| `prefs.js` | The preferences window. |
| `schemas/` | The settings. |
| `tests/` | The unit tests. |
| `tools/` | Install, pack, test, and the smoke test. |
| `requirements.md` | The requirement specification. |
