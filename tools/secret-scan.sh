#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Block a credential, a private address, or a personal path in the tree.
#
# REQ-QA-006: the repository SHALL hold no credential, no token, no private
# network name or address of the user, and no personal path. The scan reads the
# files of the tree and the messages of the commits.
#
# The scan prints the file and the line of a fault, and the hash of a commit.
# It NEVER prints the value that it found, so a report does not copy a secret
# into a log, a terminal, or a ticket.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

# The public addresses that this project needs. Add a host here with a reason:
# an address outside this list is a fault, because the address of a private
# instance or of a private network looks like every other address to a reader.
ALLOWED_HOSTS="example.com *.example.com"
ALLOWED_HOSTS="$ALLOWED_HOSTS github.com *.github.com *.gnome.org"
ALLOWED_HOSTS="$ALLOWED_HOSTS w3.org *.w3.org fsf.org *.fsf.org gnu.org *.gnu.org"

status=0
fault() {
    echo "FAIL secret-scan: $1"
    echo "  at $2"
    status=1
}

# One host against the allow-list. Each entry is its own pattern, because an
# unquoted variable in a case pattern is one literal pattern and not a list.
host_is_allowed() {
    for allowed in $ALLOWED_HOSTS; do
        case "$1" in
            $allowed) return 0 ;;
        esac
    done
    return 1
}

files=$(find . -type f -not -path './.git/*' -not -name '*.zip' -not -name '*.pyc' \
    -not -path '*/__pycache__/*' | sort)

# The rules of the tree. $1 = an extended pattern, $2 = the name of the fault.
scan_files() {
    hits=$(printf '%s\n' "$files" | xargs -d '\n' -r grep -InE "$1" 2> /dev/null | cut -d: -f1,2 || true)
    for hit in $hits; do
        fault "$2" "$hit"
    done
}

# The rules of the commit messages.
scan_history() {
    hits=$(git log --all --format='%H' 2> /dev/null | while read -r hash; do
        if git log -1 --format='%B' "$hash" 2> /dev/null | grep -qE "$1"; then
            git log -1 --format='%h' "$hash"
        fi
    done || true)
    for hit in $hits; do
        fault "$2" "the message of commit $hit"
    done
}

# 1. The name of a private network (Tailscale and the like).
pattern_net='[a-z0-9-]+\.ts\.net'
# 2. A personal path of a user.
pattern_path='/home/[A-Za-z0-9._-]+/|/Users/[A-Za-z0-9._-]+/'
# 3. A value that looks like a credential.
pattern_value='(token|secret|password|passwd|api[_-]?key|apikey|bearer)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9_./+-]{12,}'
pattern_jwt='eyJ[A-Za-z0-9_-]{10,}\.'
pattern_key='BEGIN [A-Z ]*PRIVATE KEY'
pattern_service='(ghp_|github_pat_|sk-|xoxb-|AKIA)[A-Za-z0-9_-]{16,}'

scan_files "$pattern_net" "a private network name"
scan_files "$pattern_path" "a personal path"
scan_files "$pattern_value" "a credential value"
scan_files "$pattern_jwt" "a JSON web token"
scan_files "$pattern_key" "a private key"
scan_files "$pattern_service" "a token of a service"

# 4. An address that is not in the allow-list.
addresses=$(printf '%s\n' "$files" | xargs -d '\n' -r grep -InoE 'https?://[A-Za-z0-9.-]+' 2> /dev/null || true)
for entry in $addresses; do
    file=${entry%%:*}
    rest=${entry#*:}
    line=${rest%%:*}
    host=${rest#*://}
    host=${host%%/*}
    host_is_allowed "$host" || fault 'an address that is not in the allow-list' "$file:$line"
done

scan_history "$pattern_net" "a private network name"
scan_history "$pattern_path" "a personal path"
scan_history "$pattern_value|$pattern_jwt|$pattern_key|$pattern_service" "a credential value"

if [ "$status" = 0 ]; then
    echo "secret-scan: no credential, no private address, and no personal path"
fi
exit "$status"
