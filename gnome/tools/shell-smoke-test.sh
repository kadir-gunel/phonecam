#!/bin/bash
# SPDX-License-Identifier: MIT
# Test the PhoneCam widget in a separate GNOME Shell instance.
#
# The test does not change the session of the user:
#   - a private D-Bus session, a private configuration, and a private
#     extension directory,
#   - a test engine in place of bin/phonecam, so the test needs no phone and
#     no kernel module,
#   - test programs for scrcpy and adb, and
#   - a headless shell.
#
# The test reads the menu through the accessibility interface. It needs
# at-spi2-core and python3-gi.

set -u

# Private D-Bus session: the real shell owns org.gnome.Shell on the session bus.
if [ "${PHONECAM_SMOKE_INNER:-0}" != 1 ]; then
    exec env PHONECAM_SMOKE_INNER=1 dbus-run-session -- "$0" "$@"
fi

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repo=$(CDPATH= cd -- "$root/.." && pwd)
uuid=phonecam@kadir-gunel.github.io
USER_BUS="unix:path=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/bus"
REAL_RUNTIME="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
TMP=$(mktemp -d)
SHELL_PID=""
A11Y_PID=""
REGISTRY_PID=""
BEFORE=$(ls -d "$REAL_RUNTIME"/at-spi2-* 2>/dev/null | sort)

cleanup() {
    [ -n "$SHELL_PID" ] && kill "$SHELL_PID" 2>/dev/null
    [ -n "$REGISTRY_PID" ] && kill "$REGISTRY_PID" 2>/dev/null
    [ -n "$A11Y_PID" ] && kill "$A11Y_PID" 2>/dev/null
    for dir in "$REAL_RUNTIME"/at-spi2-*; do
        [ -d "$dir" ] || continue
        printf '%s\n' "$BEFORE" | grep -qx "$dir" || rm -rf "$dir"
    done
    rm -rf "$TMP"
}
trap cleanup EXIT

fail() {
    echo "FAIL $*"
    echo "--- shell log:"
    tail -25 "$TMP/shell.log" 2>/dev/null
    echo "--- engine calls:"
    cat "$TMP/calls.log" 2>/dev/null | tail -20
    exit 1
}

# Change the state of the test engine to "the stream runs". The widget reads
# this state, so the panel shows the light of the running stream.
start_test_stream() {
    mkdir -p "$XDG_CONFIG_HOME/phonecam"
    : > "$XDG_CONFIG_HOME/phonecam/running"
    printf '90\n' > "$XDG_CONFIG_HOME/phonecam/rotation"
    printf '2\n' > "$XDG_CONFIG_HOME/phonecam/camera"
    printf 'on\n' > "$XDG_CONFIG_HOME/phonecam/mirror"
    printf 'off\n' > "$XDG_CONFIG_HOME/phonecam/mic"
}

[ -x "$(command -v gnome-shell)" ] || fail "gnome-shell is missing"
[ -x /usr/lib/at-spi2-registryd ] || fail "at-spi2-registryd is missing"

# --- private environment ----------------------------------------------------
export XDG_DATA_HOME="$TMP/data"
export XDG_CONFIG_HOME="$TMP/config"
export XDG_CACHE_HOME="$TMP/cache"
export XDG_RUNTIME_DIR="$TMP/run"
export GSETTINGS_BACKEND=keyfile
export PHONECAM_TEST_LOG="$TMP/calls.log"
mkdir -p "$XDG_DATA_HOME/gnome-shell/extensions" "$XDG_CONFIG_HOME/glib-2.0/settings" \
    "$XDG_CACHE_HOME" "$XDG_RUNTIME_DIR" "$TMP/stubs"
chmod 700 "$XDG_RUNTIME_DIR"

# --- the extension with a test engine ---------------------------------------
target="$XDG_DATA_HOME/gnome-shell/extensions/$uuid"
mkdir -p "$target/bin" "$target/etc/modprobe.d" "$target/etc/modules-load.d"
cp "$root/extension.js" "$root/prefs.js" "$root/metadata.json" "$root/stylesheet.css" "$target/"
cp -r "$root/lib" "$root/schemas" "$target/"
cp "$repo/bin/phonecam-setup" "$target/bin/"
cp "$repo/setup-v4l2loopback.sh" "$target/"
cp "$repo/etc/modprobe.d/v4l2loopback.conf" "$target/etc/modprobe.d/"
cp "$repo/etc/modules-load.d/v4l2loopback.conf" "$target/etc/modules-load.d/"
glib-compile-schemas "$target/schemas"

# The test engine keeps the state in a file of the private configuration.
cat > "$target/bin/phonecam" <<'ENGINE'
#!/bin/bash
set -u
config="${XDG_CONFIG_HOME:-$HOME/.config}/phonecam"
mkdir -p "$config"
printf '%s\t%s\n' "$(date +%H:%M:%S)" "$*" >> "${PHONECAM_TEST_LOG:-/dev/null}"
case "${1:-}" in
is-running)
    [[ -f $config/running ]] && exit 0 || exit 1
    ;;
start)
    : > "$config/running"
    echo "phonecam: camera stream started (pid 4242)"
    ;;
stop)
    rm -f "$config/running"
    echo "phonecam: camera stream stopped"
    ;;
status)
    if [[ -f $config/running ]]; then
        echo "phonecam: running (pid 4242), camera 1, orientation 0"
    else
        echo "phonecam: not running, camera 1, orientation 0"
    fi
    ;;
rotate | camera | mirror | mic)
    printf '%s\n' "${2:-}" > "$config/$1"
    echo "phonecam: $1 ${2:-}"
    ;;
preview)
    echo "phonecam: no camera stream runs. Start it with: phonecam start" >&2
    exit 1
    ;;
*)
    echo "phonecam: unknown command ${1:-}" >&2
    exit 1
    ;;
esac
ENGINE
chmod 755 "$target/bin/phonecam"

# The test programs of the other packages: they are present and adb answers.
cat > "$TMP/stubs/scrcpy" <<'STUB'
#!/bin/sh
echo "scrcpy 3.0 (test)"
STUB
# The test PipeWire daemon: it prints the nodes from a file, so the test says
# which nodes exist. The stream of the host is not part of the test.
cat > "$TMP/stubs/pw-dump" <<STUB
#!/bin/sh
cat "$TMP/pipewire.json" 2>/dev/null || echo '[]'
STUB
chmod 755 "$TMP/stubs/pw-dump"
# At the start, PipeWire holds a source of another device, not of our camera.
cat > "$TMP/pipewire.json" <<JSON
[{"info": {"props": {"media.class": "Video/Source", "node.name": "v4l2_input.other_video99"}}}]
JSON

cat > "$TMP/stubs/adb" <<STUB
#!/bin/sh
printf '%s\t%s\n' "\$(date +%H:%M:%S)" "\$*" >> "$TMP/adb.log"
[ "\${1:-}" = "get-state" ] && echo device
exit 0
STUB
chmod 755 "$TMP/stubs/scrcpy" "$TMP/stubs/adb"
export PATH="$TMP/stubs:$PATH"

cat > "$XDG_CONFIG_HOME/glib-2.0/settings/keyfile" <<EOF
[org/gnome/shell]
enabled-extensions=['$uuid']

[org/gnome/shell/extensions/phonecam]
poll-interval=5

[org/gnome/desktop/interface]
toolkit-accessibility=true
EOF

# --- accessibility bus ------------------------------------------------------
/usr/lib/at-spi-bus-launcher --launch-immediately > "$TMP/a11y.log" 2>&1 &
A11Y_PID=$!
sleep 3
export AT_SPI_BUS_ADDRESS=$(gdbus call --session --dest org.a11y.Bus --object-path /org/a11y/bus \
    --method org.a11y.Bus.GetAddress 2>/dev/null | tr -d "(')," )
[ -n "$AT_SPI_BUS_ADDRESS" ] || fail "the accessibility bus did not start"
/usr/lib/at-spi2-registryd --use-gnome-session > "$TMP/registry.log" 2>&1 &
REGISTRY_PID=$!
sleep 2

# --- shell ------------------------------------------------------------------
gnome-shell --headless --wayland --no-x11 --virtual-monitor 1600x1000 \
    > "$TMP/shell.log" 2>&1 &
SHELL_PID=$!
echo "started gnome-shell (pid $SHELL_PID)"

for _ in $(seq 1 45); do
    sleep 2
    kill -0 "$SHELL_PID" 2>/dev/null || fail "the shell stopped"
    gdbus call --session --dest org.gnome.Shell.Extensions --object-path /org/gnome/Shell/Extensions \
        --method org.gnome.Shell.Extensions.GetExtensionInfo "$uuid" 2>/dev/null |
        grep -q "state.*1.0" && break
done
info=$(gdbus call --session --dest org.gnome.Shell.Extensions --object-path /org/gnome/Shell/Extensions \
    --method org.gnome.Shell.Extensions.GetExtensionInfo "$uuid" 2>&1)
echo "$info" | grep -q "state.*1.0" || fail "$uuid did not become ACTIVE"
echo "$info" | grep -q "'error': <''>" || fail "the shell reports an extension error: $info"
echo "$info" | grep -q "'hasPrefs': <true>" || fail "the shell does not see the preferences window"
echo "extension is ACTIVE"

# The virtual camera of the host: the test expects its problem row only when
# the host has no device with the card label of the engine.
device_problem=""
if ! grep -q "PhoneCam Camera" /sys/class/video4linux/*/name 2>/dev/null; then
    device_problem="The virtual camera is missing"
    echo "note: this host has no device "PhoneCam Camera"; the test expects that problem row"
else
    echo "note: this host has the device "PhoneCam Camera""
fi

# The row of the portal case. The widget asks the PipeWire daemon whether it
# holds the source of the camera, and the applications that use the camera
# portal get their camera from PipeWire, so this row is the fix for them.
# The test PipeWire holds no source of our camera at the start, so the row
# "Restart PipeWire" must appear while the stream runs.
if [ "${PHONECAM_SMOKE_DUMP:-0}" = 1 ]; then
    python3 "$root/tools/a11y-tree.py" --wait 8 --dump
    echo "--- the test engine starts the stream"
    start_test_stream
    python3 "$root/tools/a11y-tree.py" --wait 9 --dump
    echo "dump only, no check"
    exit 0
fi

python3 "$root/tools/a11y-tree.py" --wait 8 --check --state stopped \
    --problems "$device_problem" --phone yes \
    \
    --state-line "camera 1 · 0 · microphone on" || fail "the menu test failed for the state stopped"

# --- the stream starts: change the state of the engine ----------------------
echo "--- the test engine starts the stream"
start_test_stream

python3 "$root/tools/a11y-tree.py" --wait 9 --check --state streaming \
    --problems "$device_problem" --phone yes --checked "Mirror" \
    --expect-pipewire-row yes \
    --state-line "camera 2 · flip90 · microphone off" || fail "the menu test failed for the state streaming"

# --- PipeWire finds the camera: the row goes away ---------------------------
echo "--- the test PipeWire finds the source of the camera"
cat > "$TMP/pipewire.json" <<JSON
[{"info": {"props": {"media.class": "Video/Source", "node.name": "v4l2_input._sys_devices_virtual_video4linux_video10"}}}]
JSON
python3 "$root/tools/a11y-tree.py" --wait 9 --check --state streaming \
    --problems "$device_problem" --phone yes --checked "Mirror" \
    --expect-pipewire-row no \
    --state-line "camera 2 · flip90 · microphone off" ||
    fail "the row Restart PipeWire stays although PipeWire holds the camera"

# --- the widget reads only the state ---------------------------------------
if [ -f "$TMP/calls.log" ]; then
    calls=$(wc -l < "$TMP/calls.log")
    echo "--- engine calls ($calls):"
    sort -u "$TMP/calls.log" | sed 's/^/    /'
    unexpected=$(awk -F'\t' '$2 != "is-running"' "$TMP/calls.log")
    [ -z "$unexpected" ] || fail "the widget ran a command that is not a state read: $unexpected"
else
    fail "the widget did not read the state"
fi
[ -f "$TMP/adb.log" ] || fail "the widget did not ask the phone"
grep -q "get-state" "$TMP/adb.log" || fail "the widget did not run adb get-state"

# --- disable ----------------------------------------------------------------
gnome-extensions disable "$uuid" > /dev/null 2>&1 || fail "the extension did not disable"
sleep 3
left=$(pgrep -f "$target/bin/phonecam" | wc -l)
[ "$left" = 0 ] || fail "an engine process is still running after disable"
echo "disabled without a leftover process"

echo "PASS: the widget is active, shows both states, and reads only the state"
