#!/bin/sh
# Restores a backup (SPEC2 13). Stop the app first: `docker compose stop app`. Then:
#
#   docker compose run --rm backup notes-restore [snapshot-id]          # default: latest
#
# The snapshot is restored into /srv/notes/restore-<time>/; the current config/, users/ and
# removed/ are moved aside into /srv/notes/before-restore-<time>/ (nothing is deleted), and the
# restored ones are put in their place. Then `docker compose start app`. Sessions are not in a
# backup, so everyone logs in again.
set -eu

DATA=${NOTES_DATA:-/srv/notes}
SNAP=${1:-latest}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TARGET="$DATA/restore-$STAMP"
ASIDE="$DATA/before-restore-$STAMP"

log() { printf 'restore: %s\n' "$*"; }
fail() { printf 'restore: ERROR: %s\n' "$*" >&2; exit 1; }

if [ -S "${NOTES_ADMIN_SOCKET:-/run/notes/admin.sock}" ] && notes-admin list-users >/dev/null 2>&1; then
  fail "the app is running; stop it first: docker compose stop app"
fi

mkdir -m 0700 "$TARGET"
restic restore "$SNAP" --host notes --target "$TARGET"
# Depending on the restic version the copy is restored at the target's top, or under the path
# the backup was made from (/srv/notes/snapshot).
SRC="$TARGET"
[ -d "$SRC/users" ] || SRC="$TARGET$DATA/snapshot"
[ -d "$SRC/users" ] || fail "the snapshot has no users/ folder"
mkdir -m 0700 "$ASIDE"
for part in config users removed; do
  if [ -e "$DATA/$part" ]; then mv "$DATA/$part" "$ASIDE/$part"; fi
  if [ -e "$SRC/$part" ]; then mv "$SRC/$part" "$DATA/$part"; fi
done
mkdir -p -m 0700 "$DATA/config/sessions"
# The sessions of the moment before are kept aside with the rest, but not used.
rm -rf "$TARGET"
log "restored $SNAP; the previous data is in $ASIDE"
log "start the app again: docker compose start app"
