#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Tests for the engine bin/phonecam. They need no phone, no kernel module, and
# no desktop.
#
# The state of the stream comes from the pid file and from the process of
# scrcpy. This test covers the case that made a rotation fail: the stream runs,
# but the pid file is absent.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
engine="$root/bin/phonecam"
runtime=$(mktemp -d)
fake=""
checks=0
failures=0

cleanup() {
    [ -n "$fake" ] && kill "$fake" 2>/dev/null || true
    rm -rf "$runtime"
}
trap cleanup EXIT

# The pid file and the log of the engine live in the runtime directory.
export XDG_RUNTIME_DIR="$runtime"
pidfile="$runtime/phonecam.pid"

check() {
    checks=$((checks + 1))
    if [ "$2" = 1 ]; then
        printf 'ok   %s\n' "$1"
    else
        printf 'FAIL %s%s\n' "$1" "${3:+ ($3)}"
        failures=$((failures + 1))
    fi
}

is_running() {
    if "$engine" is-running > /dev/null 2>&1; then echo 0; else echo 1; fi
}

stream_pattern='scrcpy .*--video-source=camera.*--v4l2-sink='
host_stream=$(pgrep -u "$(id -u)" -f "$stream_pattern" 2>/dev/null | head -1 || true)

# The state of the stream of this user is the subject of the test. A stream
# that already runs makes every expectation about the state "stopped" wrong,
# so the test needs a workstation without a stream. Stop the stream first:
#     phonecam stop
if [ -n "$host_stream" ]; then
    echo "skip: a stream of this user runs (pid $host_stream)."
    echo "skip: this test needs a workstation without a stream: phonecam stop"
    exit 0
fi

# --- no stream ---------------------------------------------------------------
check "no stream: is-running reports the state stopped" "$(is_running)" \
    "exit status 0 means running"
check "no stream: no pid file is written" \
    "$([ -f "$pidfile" ] && echo 0 || echo 1)"


# --- a stale pid file --------------------------------------------------------
printf '999999\n' > "$pidfile"
check "a dead pid in the file: is-running reports the state stopped" "$(is_running)"

# --- the stream runs, but the pid file is absent -----------------------------
rm -f "$pidfile"
# A process that looks like the stream of the engine: the command line of
# scrcpy, with the camera as the source and the loopback device as the sink.
bash -c 'exec -a scrcpy python3 -c "import time; time.sleep(120)" \
    --video-source=camera --v4l2-sink=/dev/video10' &
fake=$!
sleep 1

check "the stream runs without the pid file: is-running reports the state running" \
    "$([ "$(is_running)" = 0 ] && echo 1 || echo 0)" \
    "the process of scrcpy is the second source of the state"
check "is-running writes the pid file again" \
    "$([ -f "$pidfile" ] && echo 1 || echo 0)"
check "the pid file holds the pid of the stream" \
    "$([ "$(cat "$pidfile" 2>/dev/null)" = "$fake" ] && echo 1 || echo 0)" \
    "file: $(cat "$pidfile" 2>/dev/null), process: $fake"
check "status reports the state running" \
    "$("$engine" status 2>/dev/null | head -1 | grep -q 'running' && echo 1 || echo 0)"

# --- the stream ends ---------------------------------------------------------
kill "$fake" 2>/dev/null || true
fake=""
sleep 1
check "the stream ended: is-running reports the state stopped" "$(is_running)"

printf '\n%d of %d checks passed\n' "$((checks - failures))" "$checks"
[ "$failures" = 0 ]
