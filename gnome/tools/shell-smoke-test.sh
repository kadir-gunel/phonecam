#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Test the PhoneCam widget in a separate GNOME Shell instance.
#
# The repository holds two parts. The app (`app/`) owns the engine
# (bin/phonecam) and the setup commands, and it serves them to the front-end on
# the session bus. The widget (`gnome/`) is a front-end: it holds no script and
# it reads the state from the app over D-Bus. This test covers the widget and
# that conversation.
#
# The test does not change the session of the user:
#   - a private D-Bus session, a private configuration, a private prefix, and a
#     private extension directory,
#   - the app installed into the private prefix, with a test engine in place of
#     the real engine, so the test needs no phone and no kernel module,
#   - test programs for scrcpy, adb, and pw-dump, and
#   - a headless shell.
#
# The test reads the row of the widget in the system menu and its menu through
# the accessibility interface, and it reads the icon of the widget in the panel
# with the D-Bus call org.gnome.Shell.Eval. It needs at-spi2-core, python3-gi,
# and meson.

set -u

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repo=$(CDPATH= cd -- "$root/.." && pwd)
uuid=phonecam@kadir-gunel.github.io

# --- the private environment, then the private bus ---------------------------
# The bus daemon takes the environment at the moment of its start, and it
# passes THAT environment to the services it activates. The app is such a
# service of the bus, so the private XDG directories and the PATH with the test
# programs must be in place before dbus-run-session starts the daemon. This
# first pass prepares everything and exports it, and then it re-runs the script
# inside the private session.
if [ "${PHONECAM_SMOKE_INNER:-0}" != 1 ]; then
    TMP=$(mktemp -d)
    export TMP
    trap 'rm -rf "$TMP"' EXIT

    # The private XDG_RUNTIME_DIR hides the run directory of the user, so the
    # real one is kept for the cleanup of the accessibility directories.
    REAL_RUNTIME="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
    export REAL_RUNTIME

    # The bus looks for an activation file in $XDG_DATA_HOME/dbus-1/services,
    # and the shell looks for an extension in
    # $XDG_DATA_HOME/gnome-shell/extensions. The app installs with the prefix
    # $TMP, so its datadir is $TMP/share, and XDG_DATA_HOME points there for
    # both.
    export XDG_DATA_HOME="$TMP/share"
    export XDG_CONFIG_HOME="$TMP/config"
    export XDG_CACHE_HOME="$TMP/cache"
    export XDG_RUNTIME_DIR="$TMP/run"
    export GSETTINGS_BACKEND=keyfile
    export PHONECAM_TEST_LOG="$TMP/calls.log"
    mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME/glib-2.0/settings" \
        "$XDG_CACHE_HOME" "$XDG_RUNTIME_DIR" "$TMP/stubs"
    chmod 700 "$XDG_RUNTIME_DIR"

    # The test programs of the other packages: they are present and adb
    # answers. The app finds them on the PATH of the bus daemon.
    cat > "$TMP/stubs/scrcpy" <<'STUB'
#!/bin/sh
echo "scrcpy 3.0 (test)"
STUB
    # The test PipeWire daemon: it prints the nodes from a file, so the test
    # says which nodes exist. The stream of the host is not part of the test.
    cat > "$TMP/stubs/pw-dump" <<STUB
#!/bin/sh
cat "$TMP/pipewire.json" 2>/dev/null || echo '[]'
STUB
    # At the start, PipeWire holds a source of another device, not of our
    # camera.
    cat > "$TMP/pipewire.json" <<JSON
[{"info": {"props": {"media.class": "Video/Source", "node.name": "v4l2_input.other_video99"}}}]
JSON
    cat > "$TMP/stubs/adb" <<STUB
#!/bin/sh
printf '%s\t%s\n' "\$(date +%H:%M:%S)" "\$*" >> "$TMP/adb.log"
[ "\${1:-}" = "get-state" ] && echo device
exit 0
STUB
    # The test pkexec: it records its argument list and it changes nothing. The
    # root part of the installation must run from the root-owned copy in
    # /usr/local/lib/phonecam/, and the test reads that call here. The test
    # writes no file under /usr/local.
    cat > "$TMP/stubs/pkexec" <<STUB
#!/bin/sh
printf '%s\n' "\$*" >> "$TMP/pkexec.log"
exit 0
STUB
    chmod 755 "$TMP/stubs/scrcpy" "$TMP/stubs/adb" "$TMP/stubs/pw-dump" \
        "$TMP/stubs/pkexec"
    export PATH="$TMP/stubs:$PATH"

    # The private settings of the shell. The keyfile backend keeps them under
    # XDG_CONFIG_HOME, so the test leaves the settings of the user alone.
    cat > "$XDG_CONFIG_HOME/glib-2.0/settings/keyfile" <<EOF
[org/gnome/shell]
enabled-extensions=['$uuid']

[org/gnome/shell/extensions/phonecam]
poll-interval=5

[org/gnome/desktop/interface]
toolkit-accessibility=true
EOF

    # --- the app in the private prefix --------------------------------------
    command -v meson > /dev/null 2>&1 || {
        echo "FAIL meson is missing"
        exit 1
    }
    if ! (cd "$repo/app" && meson setup "$TMP/appbuild" -Dprefix="$TMP") \
            > "$TMP/meson.log" 2>&1; then
        echo "FAIL the app did not configure (meson setup)"
        tail -20 "$TMP/meson.log"
        exit 1
    fi
    if ! meson install -C "$TMP/appbuild" >> "$TMP/meson.log" 2>&1; then
        echo "FAIL the app did not install (meson install)"
        tail -20 "$TMP/meson.log"
        exit 1
    fi

    # The test engine keeps the state in a file of the private configuration.
    # The app runs the engine of its own directory, so the test replaces the
    # installed engine.
    app_dir="$XDG_DATA_HOME/phonecam-app"
    cat > "$app_dir/bin/phonecam" <<'ENGINE'
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
    chmod 755 "$app_dir/bin/phonecam"

    # The setup command installs the root-owned copy only when a file of its
    # directory differs from that copy. Mark the module script, so that this
    # test always covers the install step, also on a machine that holds a
    # root-owned copy with the same content.
    printf '\n# smoke test: this copy differs from the root-owned copy\n' \
        >> "$app_dir/setup-v4l2loopback.sh"

    # --- the widget in the private extension directory ----------------------
    # The widget is a front-end: it holds no bin/ and no etc/, only the modules
    # and the settings of the shell.
    target="$XDG_DATA_HOME/gnome-shell/extensions/$uuid"
    mkdir -p "$target"
    cp "$root/extension.js" "$root/prefs.js" "$root/metadata.json" \
        "$root/stylesheet.css" "$target/"
    cp -r "$root/lib" "$root/schemas" "$target/"
    glib-compile-schemas "$target/schemas"

    exec env PHONECAM_SMOKE_INNER=1 dbus-run-session -- "$0" "$@"
fi

: "${TMP:?the first pass did not pass the private directory}"

app_dir="$XDG_DATA_HOME/phonecam-app"
target="$XDG_DATA_HOME/gnome-shell/extensions/$uuid"
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
    # The widget holds no engine, and the app may stay alive after the widget
    # is disabled; this test stops it.
    pkill -f -- "$app_dir/main.js" 2>/dev/null
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

# Run one expression in the private shell. The test session has no pointer, so
# the test asks the shell to open the system menu, as a user does with a click.
# The shell runs with --unsafe-mode, which permits the D-Bus call
# org.gnome.Shell.Eval.
shell_eval() {
    local reply
    if ! reply=$(gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval "$1" 2>&1); then
        echo "the shell did not answer the Eval call: $reply" >&2
        return 1
    fi
    case $reply in
        "(true,"*)
            printf '%s\n' "$reply" | sed -n "s/^(true, '\(.*\)')$/\1/p"
            ;;
        *)
            echo "the shell refused the Eval call: $reply" >&2
            return 1
            ;;
    esac
}

# Open the system menu (the quick settings menu of the shell), so that the
# accessibility tree shows the row of the widget as the user sees it.
open_system_menu() {
    shell_eval "Main.panel.statusArea.quickSettings.menu.open(); 'opened'" > /dev/null ||
        fail "the shell did not open the system menu"
}

# The number of icons of this widget in the box of the system menu. The panel
# holds that icon only when the setting show-panel-icon asks for it.
panel_icon_count() {
    local expression="Main.panel.statusArea.quickSettings._indicators.get_children().filter(c => c.has_style_class_name('phonecam-panel-button')).length"
    local result
    result=$(shell_eval "$expression") ||
        fail "the shell did not answer the question about the icon in the panel"
    printf '%s\n' "$result"
}

# The width in pixels of the system menu button in the panel. The icon of the
# widget adds its own width to that number when the setting asks for the icon.
panel_width() {
    local result
    result=$(shell_eval "Main.panel.statusArea.quickSettings.get_width()") ||
        fail "the shell did not answer the question about the width of the panel"
    printf '%s\n' "$result"
}

# Change the state of the stream to "the stream runs". The app reads the state
# files of the engine, and the widget reads the state from the app, so the
# panel shows the light of the running stream.
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

# The widget must hold no script: the engine and the setup commands belong to
# the app. This is a condition of the review of extensions.gnome.org.
[ ! -e "$target/bin" ] || fail "the widget directory holds a bin/: the widget must hold no script"
[ ! -e "$target/etc" ] || fail "the widget directory holds an etc/"
[ -z "$(find "$target" -maxdepth 1 -name '*.sh' -print -quit)" ] ||
    fail "the widget directory holds a shell script"
echo "the widget directory holds no bin/, no etc/, and no shell script"

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
# --unsafe-mode opens the D-Bus call org.gnome.Shell.Eval. The test uses that
# call to open the system menu and to read the icon of the widget in the panel,
# because the test session has no pointer and cannot click the panel.
gnome-shell --unsafe-mode --headless --wayland --no-x11 --virtual-monitor 1600x1000 \
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

# The row of the menu comes from the app, and the bus starts the app on demand
# from its activation file. This is the check that the app actually runs. The
# first read of the widget is asynchronous, so the test gives the app a moment.
for _ in $(seq 1 10); do
    pgrep -f -- "$app_dir/main.js" > /dev/null && break
    sleep 1
done
pgrep -f -- "$app_dir/main.js" > /dev/null ||
    fail "the bus did not start the app from its activation file"
echo "the bus started the app"

# The virtual camera of the host: the test expects its problem row only when
# the host has no device with the card label of the engine.
device_problem=""
if ! grep -q "PhoneCam Camera" /sys/class/video4linux/*/name 2>/dev/null; then
    device_problem="The virtual camera is missing"
    echo "note: this host has no device "PhoneCam Camera"; the test expects that problem row"
else
    echo "note: this host has the device "PhoneCam Camera""
fi

# The row of the portal case. The app asks the PipeWire daemon whether it holds
# the source of the camera, and the applications that use the camera portal get
# their camera from PipeWire, so this row is the fix for them. The test
# PipeWire holds no source of our camera at the start, so the row "Restart
# PipeWire" must appear while the stream runs.
if [ "${PHONECAM_SMOKE_DUMP:-0}" = 1 ]; then
    open_system_menu
    sleep 1
    python3 "$root/tools/a11y-tree.py" --wait 8 --dump
    echo "--- the test engine starts the stream"
    start_test_stream
    python3 "$root/tools/a11y-tree.py" --wait 9 --dump
    echo "dump only, no check"
    exit 0
fi

# --- the system menu holds the widget ---------------------------------------
echo "--- the test opens the system menu"
open_system_menu
sleep 1

python3 "$root/tools/a11y-tree.py" --wait 8 --check --state stopped \
    --problems "$device_problem" --phone yes --panel-icon absent \
    --state-line "camera 1 · 0 · microphone on" || fail "the menu test failed for the state stopped"

# --- the setting show-panel-icon --------------------------------------------
# The widget is a row of the system menu. The panel holds an icon of the widget
# only when the setting asks for it, and the default is false.
echo "--- the panel shows no icon of the widget (show-panel-icon is false)"
[ "$(panel_icon_count)" = 0 ] ||
    fail "the panel holds the icon although show-panel-icon is false"
width_without=$(panel_width)
echo "the panel button is $width_without px wide without the icon"

echo "--- the setting show-panel-icon is true: the panel shows the icon"
gsettings --schemadir "$target/schemas" set org.gnome.shell.extensions.phonecam \
    show-panel-icon true
sleep 2
[ "$(panel_icon_count)" = 1 ] ||
    fail "the panel holds no icon although show-panel-icon is true"
width_with=$(panel_width)
[ "$width_with" -gt "$width_without" ] ||
    fail "the icon did not widen the panel ($width_without px then $width_with px)"
echo "the panel button is $width_with px wide with the icon: the icon adds" \
    "$((width_with - width_without)) px"
[ "$((width_with - width_without))" -le 30 ] ||
    fail "the icon of the panel is too wide: $((width_with - width_without)) px"
python3 "$root/tools/a11y-tree.py" --wait 4 --check --state stopped \
    --problems "$device_problem" --phone yes --panel-icon present \
    --state-line "camera 1 · 0 · microphone on" ||
    fail "the menu test failed with the icon in the panel"

echo "--- the setting show-panel-icon is false again"
gsettings --schemadir "$target/schemas" set org.gnome.shell.extensions.phonecam \
    show-panel-icon false
sleep 2
[ "$(panel_icon_count)" = 0 ] ||
    fail "the panel keeps the icon although show-panel-icon is false again"

# --- the stream starts: change the state of the engine ----------------------
echo "--- the test engine starts the stream"
start_test_stream

python3 "$root/tools/a11y-tree.py" --wait 9 --check --state streaming \
    --problems "$device_problem" --phone yes --checked "Mirror" \
    --expect-pipewire-row yes --panel-icon absent \
    --state-line "camera 2 · flip90 · microphone off" || fail "the menu test failed for the state streaming"

# --- PipeWire finds the camera: the row goes away ---------------------------
echo "--- the test PipeWire finds the source of the camera"
cat > "$TMP/pipewire.json" <<JSON
[{"info": {"props": {"media.class": "Video/Source", "node.name": "v4l2_input._sys_devices_virtual_video4linux_video10"}}}]
JSON
python3 "$root/tools/a11y-tree.py" --wait 9 --check --state streaming \
    --problems "$device_problem" --phone yes --checked "Mirror" \
    --expect-pipewire-row no --panel-icon absent \
    --state-line "camera 2 · flip90 · microphone off" ||
    fail "the row Restart PipeWire stays although PipeWire holds the camera"

# --- the app owns the engine ------------------------------------------------
# The widget holds no engine: it reads the state from the app, and the app runs
# the engine. The test engine logs every call, so the log is the proof that the
# app read the state of the stream.
if [ -f "$TMP/calls.log" ]; then
    calls=$(wc -l < "$TMP/calls.log")
    echo "--- engine calls ($calls):"
    sort -u "$TMP/calls.log" | sed 's/^/    /'
else
    fail "the app did not run the engine of the stream"
fi
# The app asks the phone itself, so the row of the phone in the menu comes from
# the app. The stub adb records the questions and it answers "device".
[ -f "$TMP/adb.log" ] || fail "the app did not ask the phone"
grep -q "get-state" "$TMP/adb.log" || fail "the app did not run adb get-state"

# --- the setup command: the root part runs from a root-owned copy -----------
# The row `Set up the virtual camera` runs the command bin/phonecam-setup of the
# app. That command must put a root-owned copy of the module script and of its
# configuration in /usr/local/lib/phonecam/ first, and then it must run that
# copy with pkexec. It must never give a file of the app directory to pkexec: a
# process of the user can change that file, and the file would run as root.
#
# The test runs that command, and not the row of the menu: this workstation has
# no program for a synthetic click (CON-003), and the accessibility interface of
# the shell answers no action for a row of its menu. The test pkexec of PATH
# records the argument list, so the test covers every call of the root part and
# it writes no file under /usr/local.
[ "$(command -v pkexec)" = "$TMP/stubs/pkexec" ] ||
    fail "the test pkexec is not the first pkexec of PATH: $(command -v pkexec)"
rm -f "$TMP/pkexec.log"
echo "--- the test runs the setup command of the app"
PHONECAM_NONINTERACTIVE=1 "$app_dir/bin/phonecam-setup" < /dev/null ||
    fail "the setup command of the app failed"
[ -f "$TMP/pkexec.log" ] || fail "the setup command did not run pkexec"
echo "--- pkexec calls:"
sed 's/^/    /' "$TMP/pkexec.log"

source_script="$app_dir/setup-v4l2loopback.sh"
root_dir=/usr/local/lib/phonecam
root_script="$root_dir/setup-v4l2loopback.sh"
# The test fails when the root part runs the script of the app directory: that
# script is user-writable. See the review guideline "Privileged Subprocess must
# not be user-writable" of extensions.gnome.org.
bad=$(awk -v src="$source_script" '$1 == src' "$TMP/pkexec.log")
[ -z "$bad" ] || fail "the root part ran the user-writable script: $bad"
first=$(sed -n '1p' "$TMP/pkexec.log")
case $first in
"/usr/bin/install "*) ;;
*) fail "the first pkexec call is not the install of the root-owned copy: $first" ;;
esac
last=$(sed -n '$p' "$TMP/pkexec.log")
[ "$last" = "$root_script" ] ||
    fail "the last pkexec call is not the root-owned module script: $last"
for wanted in \
    "/usr/bin/install -D -o root -g root -m 755 $source_script $root_script" \
    "/usr/bin/install -D -o root -g root -m 644 $app_dir/etc/modprobe.d/v4l2loopback.conf $root_dir/etc/modprobe.d/v4l2loopback.conf" \
    "/usr/bin/install -D -o root -g root -m 644 $app_dir/etc/modules-load.d/v4l2loopback.conf $root_dir/etc/modules-load.d/v4l2loopback.conf"; do
    grep -qxF -- "$wanted" "$TMP/pkexec.log" ||
        fail "the setup command did not make the root-owned copy: $wanted"
done
echo "the root part runs from the root-owned copy $root_script"

# --- disable ----------------------------------------------------------------
gnome-extensions disable "$uuid" > /dev/null 2>&1 || fail "the extension did not disable"
sleep 3
# The widget holds no script, so nothing of the widget can run after disable.
# The app may stay alive; the cleanup of this test stops it.
left=$(pgrep -f -- "$target" | wc -l)
[ "$left" = 0 ] || fail "a process of the widget runs after disable"
echo "disabled without a leftover process"

echo "PASS: the widget is a row of the system menu, shows both states, keeps the panel icon optional, and reads the state from the app"
