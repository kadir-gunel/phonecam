#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Install the GNOME widget for the current user. The engine of this
# repository ships with the extension, so the extension is self-contained.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repo=$(CDPATH= cd -- "$root/.." && pwd)
uuid=phonecam@kadir-gunel.github.io
target="$HOME/.local/share/gnome-shell/extensions/$uuid"

cd "$root"
mkdir -p "$target"
rm -rf "$target/lib" "$target/schemas" "$target/bin" "$target/etc"
cp extension.js prefs.js metadata.json stylesheet.css "$target/"
cp -r lib schemas "$target/"

# The engine, the setup command, the module script, and its configuration.
mkdir -p "$target/bin" "$target/etc/modprobe.d" "$target/etc/modules-load.d"
cp "$repo/bin/phonecam" "$repo/bin/phonecam-setup" "$target/bin/"
cp "$repo/setup-v4l2loopback.sh" "$target/"
cp "$repo/etc/modprobe.d/v4l2loopback.conf" "$target/etc/modprobe.d/"
cp "$repo/etc/modules-load.d/v4l2loopback.conf" "$target/etc/modules-load.d/"
chmod 755 "$target/bin/phonecam" "$target/bin/phonecam-setup" "$target/setup-v4l2loopback.sh"

glib-compile-schemas "$target/schemas"

echo "Installed $uuid in $target"
echo "Enable it with: gnome-extensions enable $uuid"
echo "The menu row \"Set up the virtual camera\" builds the module of the camera."
