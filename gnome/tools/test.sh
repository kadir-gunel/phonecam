#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Run the unit tests of the GNOME widget. No shell and no phone are necessary.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

# The tree of the repository must hold no credential, no private address, and no
# personal path (REQ-QA-006) before the tests read it. The guard is at the top of
# the repository; this script runs from gnome/tools.
"$root/../tools/secret-scan.sh"

cd "$root/tests"
gjs -m run-tests.js
