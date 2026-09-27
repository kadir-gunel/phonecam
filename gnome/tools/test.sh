#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Run the unit tests of the GNOME widget. No shell and no phone are necessary.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root/tests"
gjs -m run-tests.js
