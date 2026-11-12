#!/bin/sh
# The nightly backup (SPEC2 13). Run as `docker compose run --rm backup` by a timer
# on the host. Needs RESTIC_REPOSITORY and RESTIC_PASSWORD (and the repository's credentials).
#
#   1. remove /srv/notes/snapshot/ if an earlier run left it;
#   2. notes-admin pause-writes: the server takes every lock (it ends by itself after 2 minutes);
#   3. a hard-link copy of /srv/notes in /srv/notes/snapshot/, without snapshot/,
#      config/sessions/, cache/ and every tmp/;
#   4. notes-admin resume-writes: if the pause was no longer in force, the copy is removed and
#      the script stops with an error;
#   5. restic sends the copy to encrypted storage (30 daily, 12 monthly); the copy is removed;
#   6. only after that, notes-admin backup-done records the time.
set -eu

DATA=${NOTES_DATA:-/srv/notes}
COPY="$DATA/snapshot"

log() { printf 'backup: %s\n' "$*"; }
fail() { printf 'backup: ERROR: %s\n' "$*" >&2; exit 1; }

[ -n "${RESTIC_REPOSITORY:-}" ] || fail "RESTIC_REPOSITORY is not set (see .env.example)"
[ -n "${RESTIC_PASSWORD:-}${RESTIC_PASSWORD_FILE:-}" ] || fail "RESTIC_PASSWORD is not set (see .env.example)"

if ! restic cat config >/dev/null 2>&1; then
  log "initialising the restic repository"
  restic init
fi

# 1.
rm -rf "$COPY"

# 2. From here until resume, any failure resumes writes before stopping.
notes-admin pause-writes || fail "the server refused to pause writes"
paused=1
resume() {
  if [ "$paused" = 1 ]; then
    paused=0
    notes-admin resume-writes >/dev/null 2>&1 || true
  fi
}
trap 'resume' EXIT INT TERM

# 3. A file in the copy is a second name of the file as it is now; the app never changes a file
#    in place (4.1, rule 3), so the copy stays as it was at this moment.
mkdir -m 0700 "$COPY"
for part in config users removed; do
  if [ -e "$DATA/$part" ]; then cp -al "$DATA/$part" "$COPY/$part"; fi
done
rm -rf "$COPY/config/sessions" "$COPY/config/tmp"
# Every tmp/: the users', and those of users removed (removed/<id>-<date>/tmp).
for t in "$COPY"/users/*/tmp "$COPY"/removed/*/tmp; do
  if [ -e "$t" ]; then rm -rf "$t"; fi
done

# 4. Exit code 3 means the pause had ended by itself. The trap stays until resume-writes has
#    answered, so a signal at this moment still resumes writes.
set +e
notes-admin resume-writes
code=$?
set -e
paused=0
trap - EXIT INT TERM
if [ "$code" -ne 0 ]; then
  rm -rf "$COPY"
  fail "the pause was no longer in force when writes were resumed; the copy was removed"
fi

# 5.
cd "$COPY"
restic backup --host notes --tag nightly --one-file-system . || { cd /; rm -rf "$COPY"; fail "restic backup failed"; }
restic forget --host notes --tag nightly --keep-daily 30 --keep-monthly 12 --prune || log "WARNING: restic forget failed; old snapshots were not removed"
cd /
rm -rf "$COPY"

# 6.
notes-admin backup-done

if [ "${RESTIC_CHECK:-}" = 1 ] || [ "$(date +%u)" = 7 ]; then
  log "weekly check"
  restic check || fail "restic check found a problem"
fi
log "done"
