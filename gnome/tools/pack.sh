#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Build phonecam@kadir-gunel.github.io.shell-extension.zip for distribution.
# The `zip` program is not needed. The working tree stays clean.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repo=$(CDPATH= cd -- "$root/.." && pwd)
cd "$root"

staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT

cp extension.js prefs.js metadata.json stylesheet.css "$staging/"
cp -r lib schemas "$staging/"
mkdir -p "$staging/bin" "$staging/etc/modprobe.d" "$staging/etc/modules-load.d"
cp "$repo/bin/phonecam" "$repo/bin/phonecam-setup" "$staging/bin/"
cp "$repo/setup-v4l2loopback.sh" "$staging/"
cp "$repo/etc/modprobe.d/v4l2loopback.conf" "$staging/etc/modprobe.d/"
cp "$repo/etc/modules-load.d/v4l2loopback.conf" "$staging/etc/modules-load.d/"
chmod 755 "$staging/bin/phonecam" "$staging/bin/phonecam-setup" "$staging/setup-v4l2loopback.sh"
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
