#!/usr/bin/env bash
#
# phonecam - build the v4l2loopback module and install its configuration.
# This script is the root part of the installation and of the repair.
#
#     sudo ~/.local/share/phonecam/setup-v4l2loopback.sh
#
# The script builds the module for each installed kernel that has a header
# directory, installs the configuration for the boot, and loads the module. It
# is safe to run again.
#
set -euo pipefail

here=$(cd -- "$(dirname -- "$0")" && pwd)

say() { printf 'phonecam: %s\n' "$*"; }
die() {
  printf 'phonecam: %s\n' "$*" >&2
  exit 1
}

((EUID == 0)) || die "run this script with sudo"

# --- the sources of the module ---------------------------------------------
# The module comes from the sources of the package v4l2loopback-dkms, or from
# the kernel package of the distribution. The second case needs no build.
source_dir=$(echo /usr/src/v4l2loopback-*/)
version=""
if [[ -d $source_dir ]]; then
  version=$(basename "$source_dir")
  version=${version#v4l2loopback-}
  ((${#version} > 0)) || die "cannot read the version of the sources in $source_dir"
  say "module version $version"
elif modinfo v4l2loopback >/dev/null 2>&1; then
  say "no sources in /usr/src: the module comes from the kernel package"
else
  die "there are no v4l2loopback sources in /usr/src and the module v4l2loopback
is not available. Install the package v4l2loopback-dkms, or use a kernel that
holds the module."
fi

if [[ -n $version && -d /sys/firmware/efi ]]; then
  secure_boot=$(od -An -t u1 "/sys/firmware/efi/efivars/SecureBoot-8be4df61-93ca-11d2-aa0d-00e098032b8c" 2>/dev/null |
    tr -d ' \n' | tail -c 1 || true)
  if [[ $secure_boot == 1 ]]; then
    say "NOTE: Secure Boot is active. The module needs a signature."
    say "NOTE: set mok_signing_key and mok_certificate in /etc/dkms/framework.conf,"
    say "NOTE: then run 'sudo mokutil --import /var/lib/dkms/mok.pub' and reboot."
  fi
fi

# --- the configuration of the device ---------------------------------------
install -Dm644 "$here/etc/modprobe.d/v4l2loopback.conf" /etc/modprobe.d/v4l2loopback.conf
install -Dm644 "$here/etc/modules-load.d/v4l2loopback.conf" /etc/modules-load.d/v4l2loopback.conf
say "configuration installed in /etc/modprobe.d and /etc/modules-load.d"

# --- build for every installed kernel --------------------------------------
if [[ -n $version ]]; then
  built=0
  for kdir in /usr/lib/modules/*/; do
    kernel=$(basename "$kdir")
    if [[ ! -d $kdir/build ]]; then
      say "skip kernel $kernel (no header directory)"
      continue
    fi
    say "build for kernel $kernel"
    dkms install -m v4l2loopback -v "$version" -k "$kernel" --force
    built=$((built + 1))
  done

  ((built > 0)) || die "no kernel with a header directory was found.
Install the header package of your kernel, for example linux-headers or the headers of your kernel."
else
  say "the build of the module is not necessary"
fi

# --- load the module -------------------------------------------------------
# The camera stream and the preview window hold the video device, so the module
# cannot be removed while they run. The command bin/phonecam-setup stops them
# as the user, before it asks for the password. This script runs as root and it
# sends no signal to any process: a process can end between a check and the
# signal, and the process number can then belong to another process.
say "load the module with the new options"
if ! grep -q '^v4l2loopback ' /proc/modules; then
  modprobe v4l2loopback
  say "the module was loaded"
else
  if modprobe -r v4l2loopback 2>/dev/null; then
    modprobe v4l2loopback
    say "the module was loaded again"
  else
    say "the module is in use by another program. It stays loaded, and the new"
    say "options take effect after the next boot."
    say "stop the camera stream and the preview window first: bin/phonecam-setup"
    say "does this, or run 'phonecam stop' and close the preview window."
    say "the programs that use a camera:"
    pgrep -a -f 'scrcpy|ffplay|chromium|zoom|teams' 2>/dev/null | head -5 | sed 's/^/  /' || true
  fi
fi

modinfo v4l2loopback >/dev/null || die "the module did not load"

# The number of the device is not fixed: the module takes the number of the
# first free video device. Report the real node, and never assume one number.
label=$(sed -n 's/.*card_label="\([^"]*\)".*/\1/p' \
  "$here/etc/modprobe.d/v4l2loopback.conf" 2>/dev/null)
[[ -n $label ]] || label="PhoneCam Camera"

if command -v v4l2-ctl >/dev/null; then
  v4l2-ctl --list-devices
else
  say "v4l2-ctl is not available (package v4l2loopback-utils)."
fi

found=""
for dir in /sys/class/video4linux/*/; do
  [[ -d $dir ]] || continue
  name=$(cat "$dir/name" 2>/dev/null || echo "?")
  dev=$(cat "$dir/dev" 2>/dev/null || echo "?")
  say "$(basename "$dir"): name $name, device number $dev"
  [[ $name == "$label" ]] && found="/dev/$(basename "$dir")"
done

if [[ -n $found ]]; then
  say "OK: the virtual camera is $found"
  say "each command finds it by the name \"$label\"."
else
  say "NOTE: no device with the name \"$label\" was found."
  say "NOTE: check the options in /etc/modprobe.d/v4l2loopback.conf."
fi
