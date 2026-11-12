# Nook

Nook is a notes app for a few people, each with private notes. Every note is one Markdown file on disk
(the note format of `SPEC.md`, read by `noteformat/`). The specification is
`SPEC2.md`; where the build departs from it, or the spec was silent, `SPEC-NOTES.md` says so.
`PROGRESS.md` says what is done.

```
  packages/contract/   API routes, shapes, limits, patterns (TypeBox)
  packages/core/       the editing core: version 1's routines, reduce, describe (pure TypeScript)
  packages/server/     Fastify app, storage, accounts, photos, fonts, styles, notes-admin
  packages/web/        Svelte 5 app, CodeMirror 6 editor
  e2e/                 Playwright journeys
  noteformat/          the library that reads and renders the note format (used as it is)
  Dockerfile  compose.yaml  Caddyfile  .env.example  scripts/backup.sh  scripts/restore.sh
```

## Working on it

Node 26 runs the TypeScript directly. `noteformat/` must have its own `node_modules`
(`cd noteformat && npm ci`).

```sh
npm install                 # every workspace
npm run typecheck           # tsc (contract, core, server, e2e) and svelte-check (web)
npm run lint:css            # Stylelint (tokens, no raw colours, no !important) and the raw-colour rule for web *.ts
npm run test:core           # ported version 1 tests, scenarios, properties, bytes
npm run test:server         # every route and refusal, crash at each step, isolation, path attacks
npm run test:web            # stores (fake API client) and editor state (CodeMirror in Node)
npm test                    # the three above
npx playwright install chromium   # once
npm run test:e2e            # builds the bundle, then the journeys and the other browser cases under the real policy
npm run build               # the browser bundle into packages/web/dist
NOTES_DATA=/tmp/notes NOTES_ADMIN_SOCKET=/tmp/notes-admin.sock npm start   # the server on :3000
```

The last full run (2026-11-12, after the fixes of the review of alpha's changes, `FIXES.md`):
core 88, server 57, web 60, e2e 58 (the seven journeys, 17 table-cell cases, 12 cases of the
code review and 22 of the review of alpha's changes), all passing; typecheck and lint clean.

## Running it with Docker

```sh
cp .env.example .env              # then edit: SITE_ADDRESS, ports, restic
docker compose -p notesv2 up -d --build
docker compose -p notesv2 exec app notes-admin add-user alice     # asks for the password twice
```

A quick check of the running stack (log in, create, type, style, save, reload):
`node e2e/docker-smoke.ts https://localhost:9988 <username> <password>`.

With `SITE_ADDRESS=localhost` and the ports of `.env.example`, open <https://localhost:9988>
(Caddy's own certificate: accept it once). The app's port is not published; Caddy is in front.

### notes-admin

Run as `docker compose -p notesv2 exec app notes-admin <command>`. It talks to the running
server over `/run/notes/admin.sock`. Passwords are typed at a hidden prompt (or read from the
first line of standard input when it is not a terminal: `exec -T app notes-admin add-user bob <
password-file`).

| Command | What it does |
|---|---|
| `add-user <name>` | Makes an account (password of 12 to 256 characters) |
| `reset-password <name>` | Sets a new password and ends that user's sessions |
| `remove-user <name>` | Removes the account and its sessions; their folder moves to `removed/` |
| `list-users` | Name, id and date of every account |
| `new-id` | A fresh note id, for adding a note by hand |
| `pause-writes`, `resume-writes`, `backup-done` | Used by the backup |

## Where things are on disk

The data volume is `/srv/notes`:

```
config/users.json, sessions/, backup.json, tmp/
cache/google-fonts.json, font-previews/, tmp/
removed/<user-id>-<date>/
users/<user-id>/notes/<note-id>/note.md, note.assets/<photo>, history/<version>.md
users/<user-id>/trash/<note-id>/          (a note folder moved whole, plus trashed.json)
users/<user-id>/fonts/<slug>/, styles.json, tmp/
```

A note is a folder named by its id; its text is always `note.md` and its photos are always in
`note.assets/`. Nothing is changed in place: every file is written in a `tmp/` folder, synced and
renamed into place.

**Editing by hand.** A person with shell access may edit a `note.md` while the app runs; a
browser holding the old text is told the note changed when it saves. To add a note by hand,
make the folder elsewhere on the same disk under a new id (`notes-admin new-id`), with a
`note.md` in it, and move it into `notes/` with `mv`.

Accepted risks:

- A hand edit that lands in the instant between the server reading a note and replacing it
  during a save of the same note is overwritten, and its text is not in history.
- An editor that rewrites a file in place without changing its size or modification time is
  not noticed by the list until the note is next opened (a save still compares the bytes).
- A file edited in place by hand while the nightly backup uploads can reach that night's backup
  half-written.

## Backup and restore

The nightly backup runs in the `backup` container (restic). Put `RESTIC_REPOSITORY` and
`RESTIC_PASSWORD` (and the repository's credentials) in `.env`, then run it from a timer on the
host, for example a systemd timer or cron at 03:00:

```sh
cd /path/to/this/folder && docker compose -p notesv2 run --rm backup
```

It removes any copy left by an earlier run, pauses writes (the server takes every lock; the
pause ends by itself after two minutes; requests wait, none is refused), makes a hard-link copy
of `/srv/notes` in `/srv/notes/snapshot/` without sessions, the cache and every `tmp/`, resumes
writes (if the pause was no longer in force, it removes the copy and stops with an error), sends
the copy to restic (keeping 30 daily and 12 monthly snapshots), removes the copy, and only then
records the time, which the Account screen shows (with a warning when it is over two days old).

To restore:

```sh
docker compose -p notesv2 stop app
docker compose -p notesv2 run --rm backup notes-restore            # or a snapshot id
docker compose -p notesv2 start app
```

The current `config/`, `users/` and `removed/` are moved aside into
`/srv/notes/before-restore-<time>/` first; nothing is deleted. Sessions are not backed up, so
everyone logs in again.

## For tests: `window.__notes`

On the editor screen, `window.__notes` is `{ text(), select(from, to), intent(i) }`. `text()` is
the raw text (LF line endings, no byte order mark); `select` sets the selection by offsets into
it; `intent` applies an intent as the toolbar would and returns whether it was done. Intents
are objects with a `type` named as in SPEC2 7.3 and arguments named as in its notation, for
example `{ type: "setMark", change: { kind: "bold", on: true } }`,
`{ type: "setBlock", kind: "h2" }`, `{ type: "setList", kind: "bullet" }`,
`{ type: "insertText", text: "x" }`, `{ type: "enter" }` (or just `"enter"`),
`{ type: "setMeta", key: "title", value: "New title" }`. See `SPEC-NOTES.md`.
