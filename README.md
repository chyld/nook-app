# Nook

Nook is a notes app for a few people, each with private notes. Every note is one Markdown file on disk
(the note format of `SPEC.md`, read by `noteformat/`). A person can also make **drawings**,
edited with [Excalidraw](https://excalidraw.com) running inside Nook; each drawing is one
ordinary Excalidraw file on disk, its images inside it. The specification is `SPEC2.md`, and
`SPEC-DRAWINGS.md` for drawings; where the build departs from them, or they were silent,
`SPEC-NOTES.md` says so. `PROGRESS.md` says what is done.

```
  packages/contract/   API routes, shapes, limits, patterns (TypeBox)
  packages/core/       the editing core: version 1's routines, reduce, describe (pure TypeScript)
  packages/server/     Fastify app, storage, accounts, photos, fonts, styles, notes-admin
  packages/web/        Svelte 5 app, CodeMirror 6 editor; Excalidraw (React) for drawings, loaded on demand
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

The last full run (2026-11-12, after drawings, `SPEC-DRAWINGS.md`, and the fixes of their code
review): core 99, server 75, web 83, e2e 78 (the seven journeys, 17 table-cell cases, 12 cases
of the code review, 22 of the review of alpha's changes and 20 of drawings), all passing;
typecheck and lint clean.

The build reports the size of Excalidraw's script (`mount-*.js`, about 1.3 MB, with further
chunks for Mermaid, KaTeX and the like): it and its CSS are requested only when a drawing is
first opened. Its fonts are copied into the bundle (`dist/assets/excalidraw/fonts/`), so no
font is fetched from another address.

## Running it with Docker

```sh
docker compose up -d --build
docker compose exec app notes-admin add-user alice
```

The first command builds and starts the app. The second makes an account and asks for its
password twice. Then open <https://localhost:9988> and log in. The certificate is Caddy's own,
so the browser asks you to accept it once.

No settings file is needed, on your own machine or on a server. On a server the app is at
`https://<the server's IP address>:9988`, with the same certificate warning to accept once.

For a real certificate and no warning, point a domain name at the server, then copy
`.env.example` to `.env` and set `SITE_ADDRESS` to the name and the ports to 80 and 443 (the
backup's repository is set there too):

```sh
cp .env.example .env
```

After changing `.env` or pulling a new version: `docker compose up -d --build --force-recreate`.

A quick check of the running stack (log in, create, type, style, save, reload):
`node e2e/docker-smoke.ts https://localhost:9988 <username> <password>`.

### notes-admin

Run as `docker compose exec app notes-admin <command>`. It talks to the running
server over `/run/notes/admin.sock`. Passwords are typed at a hidden prompt (or read from the
first line of standard input when it is not a terminal: `exec -T app notes-admin add-user bob <
password-file`).

| Command | What it does |
|---|---|
| `add-user <name>` | Makes an account (password of 5 to 256 characters) |
| `reset-password <name>` | Sets a new password, ends that user's sessions and revokes their agents' tokens |
| `remove-user <name>` | Removes the account, its sessions and its agents' tokens; their folder moves to `removed/` |
| `list-users` | Name, id and date of every account |
| `new-id` | A fresh note id, for adding a note by hand |
| `pause-writes`, `resume-writes`, `backup-done` | Used by the backup |

## Agents

An AI agent (a command-line coding agent with `curl`, say) can list, read, create and save
your notes and drawings over HTTP. It cannot delete anything, move anything to the trash, or
touch photos, fonts, styles or your account. `SPEC-AGENTS.md` is the specification.

1. On the **Account** screen, under **Agents**, type a name for the agent ("Claude on the
   laptop") and press **Make a token**. The token appears on its row and stays
   there, with a Copy button.
2. Give the agent the token and the address of its guide, shown above the list:
   `https://<your address>/api/agent/v1`. The guide is one page, needs no token, and tells the
   agent everything: each route with a `curl` example, the limits, a complete example note and
   drawing, and every error with what to do about it.

For example, with the token in `NOOK_TOKEN`:

```sh
curl -sS -X POST "https://localhost:9988/api/agent/v1/items?title=Shopping&tags=food" \
  -H "Authorization: Bearer $NOOK_TOKEN" -H "Content-Type: text/markdown" --data-binary '- oats'
```

**The certificate.** Without a domain name (the default, at `localhost` or the server's IP
address), Caddy uses a certificate it makes itself, which no program verifies. A browser asks
you once; an agent stops, and a careful one will not even read the guide. Tell it so when you
give it the token:

> It's my own server with Caddy's self-signed certificate. I accept that. Use `curl -k` for
> every request to it.

The guide says the same. The traffic is still encrypted; what is skipped is the proof that the
agent is talking to your server. To make the question go away, give the server a domain name
(`SITE_ADDRESS` in `.env`, as above): the certificate is then an ordinary one.

What to know:

- **What an agent wrote is marked.** A note or drawing whose current text an agent wrote has a
  small robot in the sidebar and "Written by *name*" in its header, until you save a change.
  History says which versions an agent wrote.
- **An agent cannot push your versions out of history.** Its own versions are kept apart (the
  newest 10 of a note, 5 of a drawing). To undo what an agent did, restore a version from
  History as usual.
- **An agent's save while you have the note open** shows up as a conflict on your next save,
  as a second tab's would.
- **Revoke** an agent on the Account screen; its token stops working at once. Changing your
  password revokes all of them.
- **Limits:** at most 20 agents; together they may make 60 changes a minute and send 300 MB a
  day. An agent's save that would empty a note or a drawing, or drop an image a drawing uses,
  is refused.
- A token is a secret: whoever has it can read all your notes and write to them. Nook keeps
  your tokens so that it can show them, so they are also in `data/notes/config/agents.json` and
  in the backup.

## Where things are on disk

Everything the app keeps is in the `data/` folder beside `compose.yaml`, made on the first
start. Nothing is in a Docker volume, so copying `data/` copies the whole app's state, and
`docker compose down` (with or without `-v`) leaves it alone.

- `data/notes/`: the accounts and every note (below). The files belong to the user the app
  runs as: user and group 1000 unless `PUID` and `PGID` in `.env` say otherwise.
- `data/caddy/`, `data/caddy-config/`: Caddy's certificates (owned by root).

`data/notes/` (which the app and the scripts see as `/srv/notes`):

```
config/users.json, agents.json, sessions/, backup.json, tmp/
cache/google-fonts.json, font-previews/, tmp/
removed/<user-id>-<date>/
users/<user-id>/notes/<note-id>/note.md, note.assets/<photo>, history/<version>.md
users/<user-id>/notes/<drawing-id>/drawing.excalidraw, history/<version>.excalidraw
users/<user-id>/notes/<id>/agent-history/<version>.*, writers.json   (only where an agent wrote)
users/<user-id>/trash/<note-id>/          (a note folder moved whole, plus trashed.json)
users/<user-id>/fonts/<slug>/, styles.json, tmp/
```

A note is a folder named by its id; its text is always `note.md` and its photos are always in
`note.assets/`. A drawing is a folder of the same kind whose file is `drawing.excalidraw` (a
folder with a `note.md` is a note); a drawing keeps its newest 20 versions, a note 50. A
drawing's file is an ordinary Excalidraw file with one more key, `nook` (title, tags, date): it
opens in excalidraw.com as it is. Nothing is changed in place: every file is written in a `tmp/` folder, synced and
renamed into place.

**Editing by hand.** A person with shell access may edit a `note.md` while the app runs; a
browser holding the old text is told the note changed when it saves. To add a note by hand,
make the folder elsewhere on the same disk under a new id (`notes-admin new-id`), with a
`note.md` in it, and move it into `notes/` with `mv`. A drawing is added the same way, with a
file saved from excalidraw.com renamed `drawing.excalidraw`: it opens as `Untitled`, images
included, and its first save writes it in Nook's form (the old bytes stay in its history).

The shape library of drawings is kept in each browser's local storage (one per user), not on
the server, so it is not in the backup.

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
cd /path/to/this/folder && docker compose run --rm backup
```

It removes any copy left by an earlier run, pauses writes (the server takes every lock; the
pause ends by itself after two minutes; requests wait, none is refused), makes a hard-link copy
of `/srv/notes` in `/srv/notes/snapshot/` without sessions, the cache and every `tmp/`, resumes
writes (if the pause was no longer in force, it removes the copy and stops with an error), sends
the copy to restic (keeping 30 daily and 12 monthly snapshots), removes the copy, and only then
records the time, which the Account screen shows (with a warning when it is over two days old).

To restore:

```sh
docker compose stop app
docker compose run --rm backup notes-restore            # or a snapshot id
docker compose start app
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

On the drawing screen, `window.__drawing` is `{ text(), addText(text, x, y),
setBackground(colour), addImage(file) }`: `text()` is the file a save would write
(`SPEC-DRAWINGS.md` 4.2); the others do what the person's own action would (`addImage` drops the
file on the canvas). The element Excalidraw is in has `data-testid="drawing"` and
`data-ready="true"` once the drawing is ready.
