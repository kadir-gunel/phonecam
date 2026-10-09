#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Install the GNOME widget for the current user.
#
# The widget is a front-end. The engine (`bin/phonecam`) and the setup commands
# come with the PhoneCam app and not with this widget, so the package of the
# widget holds no script. The app talks to the widget over D-Bus; install it
# from the `app/` directory of this repository.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
uuid=phonecam@kadir-gunel.github.io
target="$HOME/.local/share/gnome-shell/extensions/$uuid"

cd "$root"
mkdir -p "$target"
# The engine, its `bin/` and its `etc/`, and the module script of an older
# installation come out: the widget holds no script now.
rm -rf "$target/lib" "$target/schemas" "$target/bin" "$target/etc"
rm -f "$target"/*.sh
cp extension.js prefs.js metadata.json stylesheet.css "$target/"
cp -r lib schemas "$target/"

glib-compile-schemas "$target/schemas"

echo "Installed $uuid in $target"
echo "Enable it with: gnome-extensions enable $uuid"
echo "The engine comes with the PhoneCam app: build and install it from app/."
