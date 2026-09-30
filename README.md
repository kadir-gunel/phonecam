# PhoneCam

> The file `preview.png` shows the old icon of the widget in the panel. It needs
> a new capture: the widget is now a row of the system menu of GNOME Shell.

Use the camera and the microphone of an Android phone as a webcam and a
microphone of this computer. The picture appears as the video device
**PhoneCam Camera** (`/dev/video*`, V4L2), so every video-conference
application can use it. The microphone appears as the audio source
**PhoneCam**.

The front-end is a row of the system menu (the quick settings menu) of GNOME
Shell 50 and later (`gnome/`). A setting can also show an icon of the widget in
the top panel. It runs the engine `bin/phonecam`, which holds the state in
`~/.config/phonecam`, so a command from the menu and a command from a terminal
give the same result.

## How it works

- The picture: the phone sends H.264 over USB (adb, scrcpy). scrcpy writes it
  into a v4l2loopback device named `PhoneCam Camera`.
- The sound: scrcpy sends the microphone as Opus. A PipeWire null sink and a
  remap source expose it as the source `PhoneCam`. The sink and the source
  exist only while the stream runs. The label holds no space on purpose:
  pipewire-pulse cuts the value of a module property at the first space.
- The device uses `exclusive_caps=1`. An application can open the camera only
  while the stream runs. **Start the stream first**, then select the camera in
  the application. An application that opened its camera list before the start
  shows no camera.
- An application that asks the camera portal (the camera application of GNOME,
  and the browsers on Wayland) gets the camera from PipeWire, and PipeWire
  reads the list of the video devices at its start. When PipeWire holds no node
  of the camera while the stream runs, the menu of the GNOME front-end shows
  the row `Restart PipeWire (for portal applications)`.

## Requirements

- An Arch-based Linux. The module `v4l2loopback` comes from the kernel package
  or from the package `v4l2loopback-dkms`. Kernel headers are necessary only
  for the second case.
- These packages:

  ```sh
  sudo pacman -S scrcpy android-tools ffmpeg v4l-utils
  ```

  `v4l-utils` holds the command `v4l2-ctl`, which the engine uses to find the
  video device by its card label. Two packages are necessary only in special
  cases:

  - `android-udev`: only when `adb` does not see the phone.
  - `v4l2loopback-dkms` and `dkms`: only when the kernel package does not hold
    the module `v4l2loopback`. The kernel `linux-cachyos` holds it.

  The command `pactl` for the virtual microphone comes with `libpulse` (or with
  `pipewire-pulse`), and `ffplay` comes with `ffmpeg`. The package
  `libcamera` is not necessary: it drives the cameras that libcamera manages
  directly, not the loopback device of the phone.

- An Android phone with USB debugging. Tested on a OnePlus 5 with
  LineageOS 22 (Android 15).
- GNOME Shell 50 or later with `gjs`.

## Install

### 1. The engine and the virtual camera

Both front-ends use these steps.

1. Install the packages (above).
2. Get the code:

   ```sh
   git clone https://github.com/kadir-gunel/phonecam
   ```

3. Build the kernel module and its configuration:

   ```sh
   ./bin/phonecam-setup
   ```

   The command stops the camera stream and the preview window of your user
   first, then it asks for the password. It puts a copy of the module script
   and of its configuration with the owner root in `/usr/local/lib/phonecam/`,
   and it runs that copy: a process of your user cannot change the file that
   runs as root. The part that runs as root sends no signal to any process.
   The GNOME front-end has the menu row `Set up the virtual camera` for the
   same step; it asks with the polkit dialog of the desktop. The command is
   safe to run again. Run it after a kernel update if the virtual camera is
   missing.

4. Connect the phone by USB, unlock it, and accept the USB-debugging question.
5. Start the stream and select `PhoneCam Camera` in the application. The menu
   of the GNOME front-end, or `bin/phonecam start`, starts the stream.

### 2. The front-end

```sh
cd gnome
./tools/install.sh
```

Then log out and log in again, because GNOME Shell reads the list of the
extensions only at start, and enable the widget:

```sh
gnome-extensions enable phonecam@kadir-gunel.github.io
```

The details are in [gnome/README.md](gnome/README.md).

## Use

The GNOME front-end is a row of the system menu; a click on the row starts or
stops the stream, and its arrow opens the menu with every command: the state,
the start and the stop, the rotation, the mirror, the microphone, the camera,
the preview window, and the setup of the virtual camera. The wheel over the row,
or over the optional icon of the panel, turns the picture, and a keyboard
shortcut starts and stops the stream (set it in the preferences; the value is
empty at the start).

From a terminal, the engine lives in the directory of the front-end. Add an
alias to `~/.bashrc`:

```sh
alias phonecam="$HOME/Projects/phonecam/bin/phonecam"
```

| Command | Result |
|---------|--------|
| `phonecam start` / `stop` | Start or stop the stream |
| `phonecam status` | Show the state, the device, the camera, the rotation |
| `phonecam camera <n>` | Use another camera of the phone (0..3) |
| `phonecam mic on` / `off` | Use or stop using the phone microphone |
| `phonecam mirror on` / `off` / `toggle` | Mirror the picture |
| `phonecam rotate` / `cycle-rotation` / `prev-rotation` | Rotate the picture |
| `phonecam preview` | Show the picture in a window |
| `phonecam is-running` | Exit 0 while the stream runs |

## Tests

```sh
./tools/secret-scan.sh              # Fails on a credential, a private address, or a personal path.
./tests/test-engine.sh              # The engine. No phone, no kernel module.
./gnome/tools/test.sh               # The unit tests of the widget.
./gnome/tools/shell-smoke-test.sh   # The widget in a separate GNOME Shell.
```

`tests/test-engine.sh` and `gnome/tools/test.sh` run the scan first. It reads
the files of the tree and the messages of the commits, and it never prints the
value that it found.

The smoke test starts a separate GNOME Shell with a private configuration and a
private extension directory, and it puts a test engine in place of
`bin/phonecam`. It opens the system menu of the shell with the D-Bus call
`org.gnome.Shell.Eval`, and it reads the row of the widget in that menu, its
menu, and the optional icon of the panel through the accessibility interface. It
does not change the session of the user.

## Remove

The front-ends:

```sh
rm -rf ~/.local/share/gnome-shell/extensions/phonecam@kadir-gunel.github.io
```

The virtual camera and the state, if you do not want them any more:

```sh
sudo rm -rf /usr/local/lib/phonecam
sudo rm /etc/modprobe.d/v4l2loopback.conf /etc/modules-load.d/v4l2loopback.conf
sudo rmmod v4l2loopback
rm -rf "$HOME/.config/phonecam"
```

## Notes

- The stream is a background `scrcpy` process. The phone shows a
  microphone-in-use indicator while it runs.
- The virtual camera is owned by `root:video`. The logged-in user gets access
  to it by an ACL for the local session (`user:...:rw-`). If your session does
  not get that ACL, add your user to the `video` group.
- One reader only: while a conference application holds the camera, the
  preview and the stream cannot open it again. Stop the stream first.
- The front-end runs in the GNOME Shell process. It spawns `bin/phonecam`,
  `pw-dump` (the state of PipeWire), and `systemctl --user restart pipewire`
  when you ask for it. The setup script needs root once, for the kernel module
  and its boot configuration.
- The engine reads and writes its state under `~/.config/phonecam`. It holds no
  credential: the phone is reached with `adb`, which holds its own key.

## License

GPL-3.0-or-later. See `LICENSE`. The project follows the license of GNOME
Shell, because an extension runs in the shell process and uses the modules of
the shell.

Copyright (c) 2026 kadir-gunel(kadir-guenel).
