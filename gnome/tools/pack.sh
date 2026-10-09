#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Build phonecam@kadir-gunel.github.io.shell-extension.zip for distribution.
# The `zip` program is not needed. The working tree stays clean.
#
# The package holds the widget only. The engine and the setup commands come
# with the PhoneCam app, because the review guidelines of extensions.gnome.org
# forbid scripts in a GNOME Shell extension package.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repo=$(CDPATH= cd -- "$root/.." && pwd)
cd "$root"

staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT

cp extension.js prefs.js metadata.json stylesheet.css "$staging/"
cp -r lib schemas "$staging/"
cp "$repo/LICENSE" "$staging/"
# The compiled schema stays out of the package: the review of
# extensions.gnome.org reports it as EGO-P-006 for GNOME 45 and later, and the
# build of the site compiles it. The installer compiles it for a local
# installation.

python3 - "$staging" <<'PY'
import pathlib
import sys
import zipfile

staging = pathlib.Path(sys.argv[1])
out = pathlib.Path('phonecam@kadir-gunel.github.io.shell-extension.zip')
members = sorted(str(path.relative_to(staging)) for path in staging.rglob('*') if path.is_file())

with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
    for member in members:
        archive.write(staging / member, member)

print(f'wrote {out} with {len(members)} files ({out.stat().st_size} bytes)')
PY
