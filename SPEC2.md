# Notes app, version 2: specification

Version 2.0, 2026-11-12 (after four rounds of review). This says what the rebuilt app does and how it is put together. Version 2
is written from scratch in a new folder, `v2/`. Nothing in `app/` is changed. Section 16 lists
what changed since each earlier draft.

**Drawings.** `SPEC-DRAWINGS.md` (draft 5, built 2026-11-12) adds drawings, edited with
Excalidraw, beside notes. It changes the sections its section 11 lists; each change is marked
here with "(SPEC-DRAWINGS)". Where this document and that one differ, that one wins.

**"Version 1" means the app as it runs today** from `app/`. `DESIGN.md` and `EDITOR-PLAN.md` are
older than the code and wrong in places; where they differ from the running app, the app wins.
The differences that matter are listed in 1.2.

## 1. Decisions

These are fixed. Reviewers should check that the spec carries them out, not reopen them.

### 1.1 Made by the owner

| Topic | Decision |
|---|---|
| Scope | The features of version 1 as it runs today, with the changes of 1.3. |
| Users | Fewer than five people, each with private notes. One VPS, Docker Compose, Caddy in front. |
| Database | None. Every note is one `.md` file on disk. Accounts, styles and history are files. |
| Note format | Fixed: `SPEC.md` (format 1.2). The `noteformat/` library is used as it is. |
| Rich mode | CodeMirror 6 over the raw Markdown text. No second document model. |
| Front end | Svelte 5 (runes), TypeScript, Vite. No SvelteKit. |
| Server | Rewritten. Node 26 running TypeScript directly, Fastify 5, one process. |
| Storage layout | New (section 4). Version 1 data is not read or converted. The app starts empty. |
| Look | Version 1's current light and dark look, rebuilt as design tokens (section 10). |
| Saving | Only when the person presses Save or Ctrl+S. No autosave. Drafts guard a crashed tab. |
| Conflicts | Two choices, "Keep mine" and "Take theirs". No compare view. |
| Rendering | In the browser only. Remote images are never loaded. |
| Login | Username and password. Accounts are made by an admin command. No sign-up, no email. |

### 1.2 Where the running app differs from the old documents

These are the owner's later choices and are kept: one mode button; a persistent sidebar and no
separate list page; no undo, redo or clear-formatting buttons (the keys remain); no size list;
no "Default" entry in the font and size controls; no custom colour; headings 1 to 6; lists and
Insert as menus; tables edited in place; photos resized by dragging; saved styles; tags beside
the title, lower-case `a-z` only; note ids of 24 characters.

### 1.3 Changes version 2 makes, confirmed by the owner on 2026-11-12

1. A note is a folder named by its id (4.2). Its file is always `note.md`.
2. Rename is no longer an action. The title is edited in the header.
3. There is no separate reading page. `/n/<id>` is the editor, and Rich mode is the reading view.
4. History and Move to trash are in Note settings.
5. `−` and `+` always change the size by 1, with or without a selection.

## 2. Why a rewrite, and the four rules that answer it

1. **State has one owner.** Each piece of state lives in exactly one store (9.2). Components
   read stores and call their actions. Nothing builds DOM by hand and patches it.
2. **In Rich mode every edit takes one path.** Every change to the text, from a key, the
   clipboard, the toolbar or a widget, is an *intent* handed to one pure function, checked by
   re-parsing, and applied as one transaction (section 7). In Raw mode typing is plain text
   entry, and the toolbar uses the same intents. The one fenced exception is the text of a
   table cell while that cell has the focus (7.7).
3. **A redesign is a change of tokens.** Colours, type, spacing and radii of the app's own
   screens are named tokens in one file (section 10).
4. **Behaviour is tested without a browser.** The editing rules are tested as plain text in
   Node. The browser tests are few and find things by fixed test ids (sections 11 and 12).

## 3. Code layout

```
v2/
  package.json            npm workspaces
  packages/
    contract/             API routes, request and answer shapes, limits, patterns (TypeBox)
    core/                 the editing core: pure TypeScript, no DOM, no Node APIs
    server/               Fastify app, storage, accounts, photos, fonts, admin command
    web/                  Svelte app
  e2e/                    Playwright journeys
  Dockerfile  compose.yaml  Caddyfile  .env.example  README.md
```

- `noteformat/` stays where it is and is imported by `core`, `server` (parser only) and `web`.
- `core` and `contract` are imported by both `server` and `web`, which never import each other.
- Dependencies: `fastify`, `@fastify/cookie`, `@fastify/multipart`, `@sinclair/typebox`,
  `argon2`, `sharp`, `svelte`, `@sveltejs/vite-plugin-svelte`, `vite`, `typescript`,
  `svelte-check`, `codemirror` and the `@codemirror/*` packages, `dompurify`, the two
  `@fontsource-variable` packages of section 10, `stylelint` with `postcss-html`, and for tests
  `playwright` and `fast-check`. Nothing else without the owner's agreement.
- (SPEC-DRAWINGS) Also `react`, `react-dom` and `@excalidraw/excalidraw`, each at an exact
  version; they are loaded only when a drawing is opened.

## 4. Storage

All sizes in this document are in bytes: 1 MB is 1,048,576 bytes.

### 4.1 Three rules

1. **One process.** Locks and the note index live in its memory.
2. **One lock per user.** Every request that reads the index or changes a file of a user holds
   that user's lock, through one wrapper, `space.run(userId, fn)`. No route touches a path or a
   lock itself. Slow work is done before taking the lock (receiving an upload, processing an
   image, downloading a font), and a file is sent to the browser after releasing it. A separate
   accounts lock covers `users.json` and sessions. Where both are needed, the user's lock is
   taken first.
3. **No file is changed in place.** A file is written to the `tmp/` folder of its own tree
   (`users/<id>/tmp/`, `config/tmp/` or `cache/tmp/`), synced, and renamed into place; the
   folder it lands in is then synced. Where an existing file must not be replaced, an exclusive
   link is used instead of the rename. When a folder is renamed from one parent to another,
   both parents are synced. A copy the app makes is always a new file with its own bytes, never
   a second link to the original. (The backup's snapshot of section 13 is the one exception.)

### 4.2 Layout

```
/srv/notes/
  config/
    users.json
    sessions/<sha256 of token>.json
    backup.json
    tmp/
  cache/
    google-fonts.json
    font-previews/<family-slug>.woff2
    tmp/
  removed/<user-id>-<date>/
  snapshot/                          the backup's copy (section 13); the app ignores it
  users/<user-id>/
    notes/<note-id>/
      note.md
      note.assets/<photo file>
      history/<version>.md
    notes/<drawing-id>/              (SPEC-DRAWINGS) a drawing, in the same id space
      drawing.excalidraw
      history/<version>.excalidraw
    trash/<note-id>/                 a note folder moved here whole, plus trashed.json
    fonts/<family-slug>/font.css, *.woff2
    styles.json
    tmp/
```

- `<user-id>` is 16 and `<note-id>` is 24 random characters from `a-z` and `2-7`.
- (SPEC-DRAWINGS) **The main file decides the kind:** a folder with a regular file `note.md` is
  a note; without one, a folder with a regular file `drawing.excalidraw` is a drawing; any other
  folder is ignored. A drawing's images are inside its file. Trash, restore, emptying,
  `removed/` and the backup move or copy whole folders, of either kind.
- **A note is a folder named by its id.** The file is always `note.md` and its photos are always
  in `note.assets/`, so a photo's path in the text is always `note.assets/<file>` (format
  section 6, with the note name `note`).
- **Identity is the folder name.** The format's optional front matter key `id` is not used: the
  app never writes it, and if a file has one it is kept as ordinary text and ignored. `SPEC.md`
  gets a note saying so; `noteformat` does not change.
- **The title shown** comes from one `core` function, `noteTitle(text)`: the front matter
  `title`, then the first level-1 heading, then `Untitled`. (The format's last fallback is the
  file name, which here is always `note`.) Titles need not be unique.
- **Front matter is written only by the person's actions:** creating a note, and editing the
  title, tags, note font or note size (7.6). The app never writes it otherwise.
- `<version>` is the save time in UTC and four random characters, as
  `2026-11-10T14-02-11.512Z-k3fa`. If the name is taken, new characters are drawn.

This layout removes four mechanisms of version 1: the id line in front matter and its writer,
rewriting photo paths on rename, the rename operation, and the journal with its recovery rules.

### 4.3 Operations on a note

Each is one rename of a folder plus steps that are safe to repeat.

| Operation | Steps | A crash leaves |
|---|---|---|
| Create | Build the folder with `note.md` in `tmp/`; rename it to `notes/<id>/`. | Nothing, or the note. |
| Trash | Write `trashed.json` (the time) into the note folder; rename the folder to `trash/<id>/`. | A live note with a stray `trashed.json`, which is ignored and replaced next time; or the trashed note. |
| Restore | Rename `trash/<id>/` to `notes/<id>/`; remove `trashed.json`. | As above. |
| Empty | For each id sent that is still in `trash/`: rename the folder into `tmp/`, then delete it. | A folder in `tmp/`. |

`tmp/` is emptied at startup. Emptying the trash is the only action a person takes that destroys
data, and it asks for confirmation. (History beyond 50 versions is removed silently, 4.4.)

The trash screen is built by listing `trash/` and reading each `note.md` and `trashed.json`. A
trashed note can be read with its photos. Its history is kept but cannot be viewed until the
note is restored.

A new note's text is front matter with `title` (as a YAML double-quoted string, with `\` and
`"` escaped) and `created` (today's date), then one blank line. With no title given, the title
is `Untitled N`, where N is the smallest number from 1 that no live note's title already uses.
A title given to the app is cleaned first: line breaks and control characters become spaces,
runs of spaces are joined, and it is trimmed and cut to 300 characters.

### 4.4 Saving

The browser loads a note's text with its **revision**, the SHA-256 of the file's bytes. A save
sends the new bytes as the request body and the revision it started from in `If-Match`. Inside
`space.run`:

1. **Find the note.** Trashed: 410. Unknown: 404.
2. **Compare.** Read `note.md` and compute its revision. If it differs from the one sent,
   answer 409 with the current text, revision and list entry, and write nothing.
3. **Check the new bytes:** valid UTF-8, at most 2 MB, and no broken front matter (below).
   Otherwise 422 with the reason.
4. **Stop if nothing changed.** Equal bytes: answer the current revision, write nothing.
5. **Write the bytes read in step 2 to history** as a new file.
6. **Replace the note** by rule 3.
7. **Remove history files** beyond the newest 50.
8. **Answer** the new revision and the note's list entry.

A crash leaves the old note or the new one, never a partial file, and at worst one extra
history file. The server never changes the bytes of a save.

(SPEC-DRAWINGS) A drawing is saved the same way, with `drawing.excalidraw` for `note.md`: its
body is the whole file (`application/vnd.excalidraw+json`, images included), at most 25 MB, and
step 3 checks only that it is valid UTF-8 and a JSON object with `type` "excalidraw" and an
array `elements` (422 `not-utf8`, `not-json` or `not-excalidraw`). Before step 2, a body type
that is not the item's kind is 415, then the kind's limit (2 MB for a note) is 413. Step 7
keeps a drawing's newest 20 versions.

**Broken front matter:** the first line is `---`, a later line is `---`, and the lines between
are not blank and do not parse as a YAML mapping. Such text is refused on save and on save as
new, with the reason. A file in that state on disk is listed with a warning and opens in Raw.

**Exact bytes.** The API carries a note's text exactly as decoded from its bytes: a byte order
mark and CRLF survive in the JSON string. The browser passes it to `core`'s `load`, which
returns the text with LF endings (so offsets mean the same in `core` and in CodeMirror), the
line ending to put back, and whether there was a byte order mark. The `editor` store keeps
those two with the open note, and `serialize` puts them back for a save, a draft and the
`dirty` comparison. If every line ending was LF or every one CRLF, a note with no edits
serializes to the same bytes. If they were mixed or there was a lone CR, the editor warns
before the first save that they will become LF. History and conflict texts take the same path.

**One save at a time.** The `editor` store sends one save and waits for its answer. A Save
pressed meanwhile is queued, at most one. It is sent only if the first save succeeds, with the
revision from that answer; on a 409, 410 or 404 the queue is dropped and the choice of 9.5 is
shown. If the person has moved to another note when an answer arrives, it changes nothing on
screen, but a successful one still removes that editor's draft when the draft's text is what
was saved.

### 4.5 The index and files edited by hand

The server keeps, per user and in memory, each live note's id, title, tags, `created`,
modification time, size and text. Nothing of it is written to disk. (SPEC-DRAWINGS) For a
drawing it keeps its kind, the facts of its `nook` key (title, tags, `created`) and the text of
its text elements (`originalText`, else `text`), never its bytes; search and the excerpt use
that text. A drawing file that is not JSON or not an Excalidraw scene is listed as broken and
titled `Untitled`.

**The folder check.** At the start of a list or a search, inside `space.run`, the server lists
`notes/` and compares each `note.md`'s modification time and size with the index. It re-reads
what changed, drops what is gone and adds what is new. A request that names a note id checks
only that note. A folder whose name is not a valid id, or without a regular file `note.md`, is
ignored. Symbolic links are ignored. A file that is not valid UTF-8 is listed as "cannot be
opened" and is never written.

- The list is sorted by modification time, newest first, and can be filtered by one tag.
- Search is a case-insensitive substring match over title, tags and text. Each result carries
  a one-line excerpt of about 120 characters around the first match in the text.

A person with shell access may edit a `note.md` while the app runs; a browser holding the old
text gets a 409 on save. Accepted risks, to be stated in the README:

- A hand edit that lands in the instant between steps 2 and 6 of a save of the same note is
  overwritten. Its text is not in history.
- An editor that rewrites a file in place without changing its size or its modification time
  is not noticed by the list until the note is next opened. A save still compares bytes.
- To add a note by hand, make the folder elsewhere on the same disk under a new id
  (`notes-admin new-id`) and move it into `notes/` with `mv`.

### 4.6 History

`history/` travels with the note folder. The history screen lists versions by time; a version
can be viewed rendered or raw, and restored. Restoring is an ordinary save by the browser: it reads the
note's current revision, then saves the old text with it, so a restore can itself be undone.
On a 409 it says the note changed and to try again. A version with broken front matter can be viewed and
copied but not restored.

(SPEC-DRAWINGS) A drawing's versions are `history/<version>.excalidraw`, the newest 20 kept;
its history screen is `/d/<id>/history`, which shows a version in Excalidraw in view mode and
restores it the same way. Every version is a whole file, so every version can be restored.

### 4.7 Save as a new note

Offered when a save meets 410 or 404, and for a draft whose note is gone. The browser sends the
text and the id it came from. The server makes a new note with that text and, if the source id
is live or in the trash, copies its `note.assets/` into the new note. Photo paths need no
change. The answer is `{ id, revision, entry, photosMissing }`; `photosMissing` is true when the
text uses photos and the source could not be found. The editor switches to the new note and
says so when photos are missing.

## 5. Accounts, sessions and security

- **Accounts:** `config/users.json` holds user id, username, argon2id hash and created date.
  Passwords are at least 12 and at most 256 characters; usernames at most 64.
- **Admin command:** `notes-admin`, run as `docker compose exec app notes-admin …`, talks to the
  running server over the socket `/run/notes/admin.sock` (folder 0700, socket 0600). Commands:
  `add-user`, `reset-password`, `remove-user`, `list-users`, `new-id`, `pause-writes`,
  `resume-writes`, `backup-done`. Passwords are typed at a hidden prompt.
  `reset-password` deletes that user's sessions. `remove-user` takes that user's lock, then the
  accounts lock, deletes the account and its sessions, and moves the user's folder to
  `removed/`.
- **Sessions:** login makes a random 256-bit token and sends it in a cookie that is `HttpOnly`,
  `Secure` and `SameSite=Lax` with `Max-Age` of 30 days. One file per session, named by the
  token's SHA-256, holds the user id, when it was made and when it was last used. A session
  ends 30 days after its last use or 90 days after it was made. Last use is written at most
  once an hour, and the cookie is sent again with a fresh lifetime when it is. Logout deletes
  the file. Ended sessions are removed at startup and once a day.
- **Changing a password** needs the current one, counts a wrong one in the login limit, and
  deletes the person's other sessions. Login and password change each take the accounts lock
  and confirm that the stored hash is still the one they checked before they write.
- **Keeping people apart:** the user id comes only from the session. One function,
  `space.notePath(userId, noteId, part)`, makes every note path. Ids, versions, photo names and
  font slugs are checked against the patterns in `contract` before use; each is one path part;
  the final path must resolve inside that user's folder; symbolic links are refused.

| Threat | Defence |
|---|---|
| Guessing a password | argon2id. 5 failures in 15 minutes block that pair of username and client address (an IPv6 address counts as its /64). An unknown username is checked against a dummy hash. |
| Flooding the login | At most two hashes run at once and ten wait; beyond that 429. The failure table holds at most 10,000 entries. Login bodies are at most 1 KB. |
| The client address | Caddy sets `X-Forwarded-For` and discards the client's. Fastify trusts it only from Caddy. |
| Script in a note | The format has no HTML; the renderer escapes; links other than `http`, `https`, `mailto` are dropped; DOMPurify; the policy below. |
| A forged request | `SameSite=Lax`; every changing route is not a GET, takes JSON, `text/markdown` or multipart only, and checks `Origin`. |
| A hostile upload | Type decided from the bytes on upload and again when served; re-encoded by `sharp`; the pixel limits of section 6; SVG never served; `nosniff`. |
| A stolen cookie | HTTPS with HSTS; `HttpOnly`; logout, password change and reset end sessions. |
| The server fetching for an attacker | Fonts are fetched only from `fonts.google.com`, `fonts.googleapis.com` and `fonts.gstatic.com`, over HTTPS, with no redirects, 5 MB and 20 seconds at most. |
| A break-in to the process | Unprivileged user, read-only root, no capabilities, `no-new-privileges`, port not published. |

Content security policy (SPEC-DRAWINGS 3.2: one loose policy for every page, which replaces
the strict one with a nonce; the owner accepts it, since one person uses the app and security
is not a constraint):

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:;
style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:;
font-src 'self' data: https:; connect-src 'self' data: blob: https:;
worker-src 'self' blob:; frame-src https:; media-src 'self' data: blob: https:;
base-uri 'none'; form-action 'self'; frame-ancestors 'none'
```

The server still writes a fresh nonce into `<meta name="csp-nonce">` in the page; the script
reads it and gives it to CodeMirror's `cspNonce` (the policy no longer names it). Svelte's `transition:`, `in:`, `out:` and `animate:`
directives add style elements at run time and are **not used**; motion is done with CSS
classes. Also sent: `Referrer-Policy: no-referrer`. Logs hold the method, route pattern, status
and time taken, and never a query string, body, note text or password.

## 6. API

Every route, its request and its answer are declared once in `contract` as TypeBox schemas. The
server registers routes from them, so a request that does not match is refused with 400 before
any handler runs. The browser's client is typed from the same declarations.

An error answer is `{ error: { code, message } }`. A 409 on save adds
`current: { text, revision, entry }`.

| Status | Meaning |
|---|---|
| 400 | The request does not match its schema |
| 401 | No session |
| 403 | Wrong `Origin` |
| 404 | No such note, version, photo, font or style |
| 409 | The note changed since the revision sent; or a limit of 40 fonts or 50 styles is reached |
| 410 | The note is in the trash |
| 413 | Too large |
| 422 | The text is refused: not UTF-8, or broken front matter; or an upload is not an image |
| 429 | Too many login attempts, or the server is busy with photos |

(SPEC-DRAWINGS) Every list and trash entry carries `kind` ("note" or "drawing"). The photo and
asset routes answer 404 for a drawing.

JSON bodies are at most 64 KB (1 KB for login and password). Every `/api` route but login needs
a session. Answers carry `Cache-Control: no-store`, except photos and font files (`private`).

| Route | Purpose |
|---|---|
| `POST /api/login`, `POST /api/logout` | Start and end a session |
| `GET /api/me`, `POST /api/password` | Who am I, and the last backup time; change password |
| `GET /api/notes?tag=&q=` | List or search: entries (with `excerpt` when searching) and tag counts. `tag` and `q` may be given together and both apply. Tag counts are always of all live notes. |
| `POST /api/notes` | Create: JSON `{ title?, kind? }` (`kind` "note" or "drawing", "note" by default; SPEC-DRAWINGS). Save as new: a `text/markdown` body, or a drawing's `application/vnd.excalidraw+json`, with `?from=<id>` |
| `GET /api/notes/:id` | `{ text, revision, entry }` |
| `PUT /api/notes/:id` | Save: a `text/markdown` body of at most 2 MB, or for a drawing an `application/vnd.excalidraw+json` body of at most 25 MB (SPEC-DRAWINGS), with `If-Match: <revision>`; 415 when the body is not of the item's kind |
| `DELETE /api/notes/:id` | Move to the trash |
| `GET /api/notes/:id/history`, `GET /api/notes/:id/history/:version` | Versions; one version's text |
| `POST /api/notes/:id/photos`, `GET /api/notes/:id/assets/:file` | Upload; fetch |
| `GET /api/trash`, `GET /api/trash/:id`, `GET /api/trash/:id/assets/:file` | List and read the trash |
| `POST /api/trash/:id/restore`, `POST /api/trash/empty` | Restore; empty `{ ids }`, one id or all shown |
| `GET /api/styles`, `PUT /api/styles/:name`, `DELETE /api/styles/:name` | Saved styles |
| `GET /api/fonts/catalogue?q=&category=&offset=`, `GET /api/fonts/preview/:slug` | Browse Google Fonts: a page of families and the `total` |
| `GET /api/fonts`, `POST /api/fonts`, `DELETE /api/fonts/:slug`, `GET /api/fonts.css`, `GET /api/fonts/:slug/:file` | My fonts |
| `GET /assets/*`, `GET /favicon.svg` | The built bundle (cached for a year; names carry a hash) and the icon. No session needed. |
| `GET` of any address in 9.1 | The HTML page with its nonce. No session needed; the page itself shows the login. |

**Photos.** Paste, drop or pick; 25 MB at most (Caddy allows 27 MB). JPEG, PNG, WebP, GIF and
AVIF, decided from the bytes. `sharp` applies the rotation, removes all metadata, scales a
still image's longer side to at most 2560 pixels and an animation's to 1280, and keeps
animation. An image of over 120 million pixels, or an animation of over 25 million pixels
counting every frame, is refused. Two images are processed at once and four may wait; beyond
that 429. The stored name is the original name reduced to `A-Z a-z 0-9 _ -`, `photo` if nothing
is left, the detected type's extension, and a number added until it is free. The answer is
`{ file }`; the editor inserts `![](note.assets/<file>)`. A photo is served only if its bytes
are one of the five types.

**Fonts.** The server fetches the family list from `https://fonts.google.com/metadata/fonts`
and keeps it in `cache/google-fonts.json`, refreshed weekly; if a fetch fails it keeps the list
it has. A slug is the family name in lower case with spaces as hyphens, `[a-z0-9-]{1,60}`, and
must be in the catalogue. Each family in view is shown in its own typeface from a preview font
holding only the letters of its name. Adding a font downloads its regular, bold, italic and
bold-italic styles (or the one variable file) in WOFF2, Latin and extended Latin only, into
`tmp/`, then renames the folder into `fonts/` under the lock. It asks Google's CSS endpoint
with a current browser's user agent, which answers with WOFF2 addresses, and keeps the blocks
marked `latin` and `latin-ext`. At most 40 families per user. Every screen but the login links
`/api/fonts.css`. A browser never talks to Google.

**Saved styles.** `styles.json` holds at most 50 styles: `name` (1 to 40 characters, unique),
`bold`, `italic`, `underline`, `strike`, and `size`, `font`, `color`, `bg`, each a value or
null. `PUT /api/styles/:name` takes `{ style, renameFrom? }` and saves, replaces or renames in
one step under the lock.

## 7. The editing core (`core`)

This is the centre of the rebuild. It is pure TypeScript with no DOM, so all of it runs in Node.

### 7.1 Version 1's routines and tests are the definition

Version 1 already has a working, tested set of pure editing routines in `app/shared/style/` and
`app/shared/fmwriter.ts`. What made version 1 fragile was the wiring around them, not these
routines. So:

- **`core` starts as a port of those routines.** They may be reorganised but not redesigned.
- **Their tests are ported first and define the behaviour:** `style-typing`, `style-typing-gen`,
  `style-examples`, `style-acceptance`, `style-gen`, `style-blocks`, `style-widgets`, `tables`,
  `cells` and `fmwriter` in `app/shared/test/`, with their helpers `gen.ts`, `style-oracle.ts`
  and `fixtures/`. Their expected results are not changed, except as listed below. **Where a
  table or sentence in this section disagrees with a ported test or with the routine it
  describes, the test and the routine win** and the spec is corrected.
- **The only expectations that change** are those of size stepping, because `−` and `+` now
  move by 1 point (1.3): `style-examples` ("sizes", and the `nextSize` cases),
  `style-acceptance` and `style-gen` where they use `size-step`, and `style-oracle`'s
  `size-step`. The list of sizes and `nextSize` are removed.
- **Not ported to `core`:** `idwriter`, `names` and `photopaths` (version 2 has none of those
  mechanisms); `text.test` (its revision includes the file name; version 2's is of the bytes
  only, and is tested in `server`); `rich-display` and `renderer` (they need CodeMirror or the
  DOM; they are rewritten as "Editor state" and `web` tests, section 12).
- `EDITOR-PLAN.md` section 5 is background reading only.

### 7.2 What is new in `core`

Version 1 kept some editing rules in its browser code. They move into `core`, each with
scenarios (section 12), so that the browser holds none:

| Rule | Where version 1 has it |
|---|---|
| The single entry point `reduce`, and `describe` | `selectionState` and `run` in `web/src/toolbar.ts`; `applyEdit` in `richedit.ts` |
| `typing.marks` and `typing.block`, and when they are cleared | `pendingField`, `pendingBlockField`, `typeInto` in `richedit.ts` |
| What Enter carries on | `styleToCarry` in `richedit.ts` |
| Block styles excluding each other; leaving a code block from the Block menu | `block()` and `change()` in `toolbar.ts` |
| A list marker on an empty line; "No list" | `list()` in `toolbar.ts` |
| Applying a saved style as several changes | `useStyle` and `changesOf` in `toolbar.ts` |
| Tag and title cleaning before a write | `web/src/editor.ts`, `notesettings.ts` |
| The toolbar's state in a table cell (`describeCell`); a style with nothing selected in a cell | `styleCell` in `web/src/richtable.ts`; the private `inner` of `cells.ts` |
| Keeping the selection after a widget or settings edit, by mapping it through `edit` | New (version 1 reuses the old offset) |
| On, off and mixed in `ToolbarState` | New (version 1's `selectionState` gives yes or no) |
| `load` and `serialize`; `noteTitle` | New |

### 7.3 Shapes

```ts
type Change = /* version 1's, from shared/style/apply.ts, with "size-step" now meaning 1 pt */;
type BlockKind = "paragraph" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "quote" | "code";
type ListKind = "none" | "bullet" | "ordered" | "task";   // the routines' names, plus "none"

type Doc = {
  text: string;                              // the Markdown, with LF line endings
  sel: { anchor: number; head: number };     // offsets into text
  typing: { marks: Change[]; block: BlockKind | null };   // what the next typed text gets
};
type Result =
  | { ok: true; doc: Doc; edit: { from: number; to: number; insert: string } | null;
      model: Model; then?: Intent; skipped?: Skipped }
  | { ok: false; reason: string };

function reduce(doc: Doc, intent: Intent, mode: "rich" | "raw"): Result;
function describe(doc: Doc, model: Model): ToolbarState;
function describeCell(cellSource: string, from: number, to: number): ToolbarState;
function noteTitle(text: string): string;      // 4.2
function load(text: string): { text: string; eol: "\n" | "\r\n"; bom: boolean; mixed: boolean };
function serialize(text: string, eol: "\n" | "\r\n", bom: boolean): string;
```

- `Model` and `Skipped` are version 1's (`buildModel` in `model.ts`; the skipped count and
  reason of `apply.ts`).
- `edit` is the one range that differs between the old text and the new, found by their common
  prefix and suffix, as version 1's `applyEdit` does. It is null when only `typing` or the
  selection changed.
- `model` is the parse of the new text; the view reuses it and does not parse again. `reduce`
  itself may parse several candidate texts, as the routines do.
- `then` is a second intent the editor applies as its own undo step. Its only use is
  `shortcut`, after a typed space or backtick.
- `ToolbarState` holds, for the selection or the caret: `bold`, `italic`, `underline`, `strike`
  and `code` (each on, off or mixed); `color`, `bg`, `font` and `size` (a value, none, or
  mixed); `block`; `list`; `link`; `inCode`; and for each command whether it can apply.

`Intent` is one of:

| Intent | Routine it wraps | From |
|---|---|---|
| `insertText(text)` | `typeText`; `pastePlain` when the text has a line break | Typed text, composition end, autocorrect, dictation. It replaces `doc.sel`, which the editor sets to the range it was given. |
| `deleteBackward`, `deleteForward`, and their word forms; `cut` | `deleteAt`, `deleteRange` | Keys |
| `enter`, `lineBreak` | `enter`, `lineBreak` | Enter, Shift+Enter |
| `paste({ plain, markdown? })` | `pasteMarkdown`, `pastePlain` | Clipboard; `markdown` is set only from the app's own clipboard type |
| `setMark(change)` | `applyStyle` | Bold, italic, underline, strike, code, colour, highlight, font, size, size step, clear |
| `applyStyle(saved or "reset")` | `applyStyle`, once per property | Styles menu |
| `shortcut` | `lineShortcut`, which removes the typed marker characters and sets the block | Only as `then` |
| `setBlock(kind)` | `setBlockStyle`, `leaveCode` | Block menu |
| `setList(kind)` | `toggleList` | List menu |
| `setLink(href or null)` | Version 1's link routine | Link panel |
| `insertBlock("table" or "rule")`, `insertPhoto(file)` | `insertBlock`; `insertBlocks` for a photo | Insert menu; an image after its upload |
| `setImageWidth(at, value)`, `toggleTask(at)` | `widgets.ts`. `at` is the index of the visible character, as the routines take it; a width is a whole percentage from 5 to 100. | Photo drag, checkbox click |
| `tableEdit(at, op, pending?)` | `parseTable`, `replaceTable`, `cells.ts` | `at` is a position inside the table; `reduce` finds its extent from the model. `op` is `setCell(row, col, runs)`, `setCellSource(row, col, markdown)`, `styleCell(row, col, from, to, change)`, `addRow(after)`, `removeRow(row)`, `addColumn(after)` or `removeColumn(col)`. `pending` is a cell's unsaved content, written in the same edit (7.7). |
| `setMeta(key, value)` | `writeSetting` | Title, tags, note font, note size |

Undo and redo are not intents. They are CodeMirror's history (section 8).

**Intents set a value; the old routines toggle.** `toggleList` and `styleCellText` flip. The
adapter in `reduce` first reads the current state and calls the routine only if the value must
change, so `setList("bullet")` on a bulleted list changes nothing, and `setList("none")` calls
`toggleList` with the list's own kind. The toolbar decides the value: a bold-like button sends
`on: true` if any selected character lacks the style, else `on: false`.

### 7.4 What `reduce` guarantees

1. **Checked by the routines.** Each routine checks its own result by re-parsing, as in version
   1 (`check.ts` for styles; the checks inside `typing.ts`, `blocks.ts`, `tables.ts`,
   `widgets.ts`; `writeSetting`'s). `reduce` never weakens or bypasses them. A result that
   fails is a refusal with a reason the person can read, and nothing changes. Where a routine
   has no check or gives no reason (`insertBlock`, `leaveCode`, `removeRow`, `removeColumn`),
   `reduce` re-parses the result itself, checks that the other visible text is unchanged,
   and supplies the reason.
2. **Checked again by one wrapper rule: the edit stays in its region.** The region is:

   | Intent | Region |
   |---|---|
   | `setMeta` | The front matter block, including an empty one (`---`, `---`), or position 0 when there is none |
   | `tableEdit` | That table |
   | `setImageWidth`, `toggleTask` | The block that holds the node |
   | Every other intent | The blocks the selection touches and one block on either side, with the blank lines between them. With the caret on a blank line between blocks, the blocks on either side. |

   A block's extent is version 1's `region()` in `typing.ts`: from the start of its first line
   to the end of its attribute line if it has one, with the blank lines after it. A table is
   one block. Where there is no block on a side, the region runs to that end of the text; in
   an empty note it is the whole text. The ends are inclusive. `edit` must lie inside the
   region, so bytes outside it are identical. This is the property the generated tests check
   for every intent.
3. **`typing` is ordinary state,** with version 1's rules:
   - `setMark` with an empty selection changes `typing.marks` and not the text. `setBlock` on
     an empty line with no block changes `typing.block`.
   - `insertText` applies both to what it inserts. A space typed alone leaves `typing.marks`
     waiting for the next letter.
   - `enter` sets `typing.marks` to what `styleToCarry` gives: the waiting marks if there are
     any; otherwise, only when the caret was at the end of its paragraph, the style of the
     character before it, without bold in a heading, without underline on a link, without a
     size equal to the note's size or any size in a heading, and nothing out of code.
   - A space typed alone also leaves `typing.block` waiting. Any other change to the text
     clears them. So does moving the caret with the keyboard or selecting text. A plain click
     that leaves the selection empty does not.
   - In Raw mode there is no `typing`: `setBlock` on an empty line writes the block's marks
     at once, as version 1 does.
4. **Typed text is tried in the three encodings of `typeText`:** as typed, escaped where it
   would act as markup, and with a backslash before every ASCII punctuation character. If
   none passes, it is refused and the reason shown.
5. **Raw mode.** The toolbar's intents work on the same text; a raw selection is cut to its
   visible characters as version 1 does (`selectedChars`). `setMark` with an empty selection is
   refused with "Select some text first".
6. **The selection it returns** is what the routine returned. Where a routine returns none
   (the widget routines, `writeSetting`), it is the old selection mapped through `edit`.
   Keeping the caret out of hidden markup is the view's job (section 8).

### 7.5 Structure rules

This table summarises what the routines do for Enter and for Backspace at the start of a block.
"Ported" rows are fixed by a ported test; "new" rows need a new scenario and, where marked, a
change to the routine.

| Block | Caret | Enter | Backspace at the start | |
|---|---|---|---|---|
| Paragraph | End | New paragraph, after the block's attribute line if it has one | See the next table | Ported |
| Paragraph | Inside | Splits at the caret; a space at the split is dropped. Inline markup open at the caret is closed and reopened; both halves keep a copy of the block's attribute line. | See the next table | Ported |
| Heading | Inside or end | Splits into two headings of that level (`# Tit¦le` gives `# Tit` and `# ¦le`). At the end, the next text typed is a normal paragraph. | Becomes a paragraph | Ported |
| Quote | Line with text | A new paragraph inside the quote (`> quo¦ted` gives `> quo`, `>`, `> ¦ted`) | Becomes a paragraph | Ported |
| List item with text | Inside or end | Splits into the next item of the same kind; a numbered item takes the next number; a task starts unticked | Becomes a paragraph, with a blank line on each side where the list goes on | Ported |
| List item with text | Start | An empty item is added above; the caret stays with the text | As above | New scenario for what `enter` does |
| Empty list item | | Ends the list: the marker is removed | The marker is removed | Enter ported; Backspace new scenario |
| Code block | Not on an empty last line | A new line inside the block | Plain delete; at the block's first character, refused | Enter ported; the rest new scenarios |
| Code block | Empty last line | Removes that line and puts the caret on a new line under the block (`leaveCode`) | Plain delete | New scenarios |

The start of a heading or a quote on Enter, and an empty quote line, do what `enter` does today;
each gets a new scenario that records it.

Shift+Enter is `lineBreak`: a hard break inside a paragraph, quote line or list item; a new
line in a code block; on an empty line, the same as Enter. It is refused, with its reason, in a
heading and at the very start or end of a paragraph. Tab leaves the editor in Rich mode.

Backspace at the start of a paragraph, by what is above it (`joinBlocks`):

| Above | Result | |
|---|---|---|
| Nothing (first block) | Nothing | Ported |
| Paragraph, heading, quote or list item | The paragraph's text joins the end of that block and takes the look that block gives. Refused, with the reason, if the block above has an attribute line. | Ported |
| Horizontal line | The line is removed | Ported |
| Code block | Refused, with the reason | New scenario for what `joinBlocks` does |
| Table | The cells are skipped: with a block above the table the join is tried across it and refused; with none, nothing happens | New scenario for what `backspaceAtStart` does |

Delete at the end of a block is `deleteAt` forward, which has its own rules (a heading below
is joined; a line below is refused); new scenarios record them. A photo is an image character
inside a paragraph and is deleted like any character.

Typed text keeps the style of the character before it, or at the start of a block the one after
it; `typing.marks` overrides both.

### 7.6 Other behaviour

Each bullet says where the behaviour is fixed.

- **Typing is literal in Rich mode** (ported): a character that would act as markup is escaped.
- **Line-start shortcuts** (ported, `lineShortcut`): `# ` to `#### `, `- ` or `* `, `1. `,
  `[] `, `> ` and three backticks, in a top-level paragraph. The typed characters go in first
  as literal text. After a space or a backtick, if the line is then a shortcut, `reduce`
  returns the structure change as `then`.
- **Deleting** (ported) removes visible characters; hidden markup is skipped as a unit.
- **Block styles exclude each other** (new in `core`, 7.2). Choosing one first turns the block
  back into a paragraph, then applies the other. On an empty line it becomes `typing.block`.
  Inside a code block, another style converts the block; if it cannot be converted, or the
  caret is on an empty line of it, the caret moves to a new line under the block (`leaveCode`)
  and the style becomes `typing.block`.
- **Lists** (new in `core`, 7.2). On an empty line or an item with only its marker, the marker
  is written, changed or removed directly. A numbered item continues from the item above. A
  blank line is added where the format needs one next to plain text. Otherwise `toggleList`.
- **Size** is in points, 1 to 400 with one decimal (ported). The box shows the size at the
  caret and is empty for a mixed selection. A typed number is accepted on Enter; one outside
  the range is refused with a message. `−` and `+` send `size-step`, which moves every selected
  character 1 point from its own size (changed, 7.1). With no selection they set
  `typing.marks` to the shown size plus or minus 1.
- **A size equal to what the block already gives removes the attribute** (ported, `natural`
  in `apply.ts`): the note's size for a paragraph and that size times 2, 1.5, 1.1667, 1,
  0.9167 and 0.8333 for headings 1 to 6. A font is always written, as today.
- **Link** (ported). With a selection the panel sets or removes its link. Clicking a link
  selects it (`linkAt` in `widgets.ts`) and opens the panel to edit, open or remove it. With
  nothing selected, Ctrl+K is refused with "Select some text first".
- **Insert** (ported, `insertBlock`). A table or a line goes in at the caret's empty line, or
  after the caret's block. After a line, the caret is on a new empty line under it.
- **Copy and paste** (ported, `copySelection`, `pasteMarkdown`, `pastePlain`). Copy puts the
  visible text on the clipboard as `text/plain` and the raw Markdown under the app's own type,
  `text/x-notes-markdown`. Paste with that type keeps formatting; any other paste is plain
  literal text, one paragraph per line.
- **`setMeta`** is `writeSetting` unchanged (ported, `fmwriter.test`): it writes the key's last
  top-level line, adds a line, or adds a front matter block; it quotes a value only when YAML
  needs it; removing the last key removes the whole block. A value it cannot write safely is
  shown read-only with "edit in Raw", and with broken front matter the controls are disabled.
  The rules for what may be written are applied before it is called (new in `core`, 7.2): a
  title is cleaned as in 4.3 and an empty one removes the key; a tag is lower-case `a-z`, at
  most 30 characters; tags are written as a flow list. A tag written by
  hand with other characters is shown as written and can be removed.

### 7.7 Tables

Version 1's way of editing a table is kept, because it works and is tested (`tables.test`,
`cells.test`). It is the one place where text is edited outside `reduce`, and it is fenced in:

- A table is a widget. Clicking a cell makes that cell an editable region; the browser edits
  its text there, with the browser's own caret, composition and undo.
- **The cell is written to the note as one intent** when it is left (blur, Tab, Shift+Tab,
  Enter), and only if its content differs from what it held when it was entered. The widget
  reads the cell's runs from its DOM and sends `tableEdit(setCell(row, col, runs))`, which
  `cellMarkdown` turns into the cell's text: spaces at the ends go and a line break becomes a
  space. That is one undo step in CodeMirror's history. Escape leaves the cell and discards
  what was typed in it.
- **A cell the widget cannot show as runs** (one holding a photo, for example) is edited as its
  Markdown text, as version 1 does, and written with `setCellSource`. The toolbar's styles do
  not apply to such a cell.
- **A style in a cell** is `styleCell(row, col, from, to, change)`. `from` and `to` count the
  cell's visible characters (Unicode code points, as `styleCellText` counts them), lower first,
  not counting spaces at the cell's start; the widget converts to and from the DOM's UTF-16
  offsets, and puts the selection back afterwards. With nothing selected, the style applies to
  the whole cell; an empty cell refuses it. The toolbar's state in a cell comes from
  `describeCell`. Ctrl+B, Ctrl+I and Ctrl+U work in a cell through the same intent.
- **Unsaved cell text is never left behind.** A style, a row or column button, Tab and Enter
  carry the focused cell's content as `pending`, so the cell and the operation are written as
  one edit and one undo step. The buttons do not take the focus from the cell.
- Tab moves to the next cell and makes a new row after the last. Enter and Shift+Enter move to
  the cell below, and in the last row add a row and move into it.
- The buttons under the table send `addRow`, `removeRow`, `addColumn` and `removeColumn`.
- `replaceTable` rewrites the whole table, so the region of a `tableEdit` is the table (7.4).
  `reduce` adds one check of its own: parsed again, every cell the operation did not name
  holds what it held before. A table that `parseTable` cannot read is edited only as text.
- "Edit as text" shows the table's raw rows. There, typing and editing keys are plain text
  entry, as in Raw mode, until the caret leaves the table.

## 8. The editor in the browser

Version 1's `richedit.ts`, `rich.ts`, `richtable.ts` and `richwidgets.ts` work in CodeMirror
today. They are the reference for the mechanisms below.

- **One CodeMirror view per open note.** Its document is `load().text`. Rich and Raw are the
  same view with different extensions, so switching keeps the caret, selection, scroll position
  and undo history. Multiple selections are off.
- **One state field** holds the model of the current text, `typing`, and the ranges of tables
  shown as text. It is rebuilt in the same transaction as each change: from the `model` an
  intent returned, or by parsing when the change came another way (undo, redo, a load, Raw
  typing). Decorations come only from it: hidden atomic ranges for markup, for link reference
  definition lines and for the whole front matter block (from position 0 to the start of the
  body), marks for styles, widgets for photos, checkboxes, tables and lines, and
  joined display for soft line breaks. Nothing is drawn from an older parse.
- **One function, `dispatchIntent(view, intent)`,** builds the `Doc` from the state, calls
  `reduce`, and applies `edit`, the new selection and `typing` as one transaction marked as an
  intent; then applies `then`, if any, as a second. A refusal is shown as a toast.
- **Where input becomes an intent, in Rich mode:**

  | Input | Handler | Intent |
  |---|---|---|
  | Typed text, autocorrect, dictation | CodeMirror's `inputHandler`, which is given the range and the text. It stands aside while composing. | `insertText` over that range |
  | Enter, Shift+Enter, Backspace, Delete and their word forms | A keymap at the highest precedence | `enter`, `lineBreak`, the deletes |
  | Copy, cut, paste | DOM event handlers, which read and write the clipboard themselves | `cut`, `paste` |
  | A dropped or pasted image file | DOM event handlers: upload, then | `insertPhoto` |
  | Dropped text | Refused in Rich mode | |
  | Toolbar, header, widgets | Direct calls | Any |

  Inside a table shown as text these handlers stand aside and CodeMirror's ordinary editing
  commands apply, as in Raw mode.
- **A transaction filter in Rich mode** only drops. It lets a document change through if it is
  marked as an intent; if its user event is `undo` or `redo`; if it is marked as a load ("Take
  theirs", opening a draft); if its user event begins `input.type.compose`; or if it lies
  inside a table shown as text. Any other change is dropped. The filter never creates an
  intent.
- **History.** `dispatchIntent` gives typing the user event `input.type` and deletes
  `delete.backward` or `delete.forward`, so CodeMirror groups consecutive ones into one undo
  step by its usual rules. Every other intent, and `then`, is its own step, isolated on both
  sides (`isolateHistory` "full"), so typing just after it does not join it. That includes a
  committed table cell and a title, tag or setting change. `typing` is cleared by an undo or
  redo.
- **Composition** (IME, and much typing on phones).
  1. At `compositionstart` the text, the selection `from` and `to`, and `typing` are
     remembered, and a history boundary is set (the history's `joinToEvent` refuses to join
     `input.type.compose.start` to what came before), so undo never goes back past the
     remembered text in one step.
  2. While composing, the composed text goes in as CodeMirror puts it. The filter also lets
     through the change CodeMirror itself makes at the start of a composition to remove a
     selection that spans blocks.
  3. When the composition has ended and CodeMirror has made its last update for it (the view
     reports that it is no longer composing; on Android this comes a frame later, so a timer
     is not enough), the composed text is read from the document: it is what
     now stands between `from` and the point that lies as far from the end of the text as `to`
     did. (Comparing the two texts for a smallest difference is wrong when the composition
     replaced a selection.)
  4. `insertText` of that text is reduced against the remembered document and selection.
  5. If its result is the text already on screen, only `typing` and the selection are updated.
     Otherwise one transaction with the user event `input.type.compose` changes the screen
     text into the result. CodeMirror's history joins that event to the composition, so in
     both cases the whole composition is one undo step back to the remembered text.
  6. If `reduce` refuses, the same kind of transaction puts the remembered text back, and the
     reason is shown.
- **The caret stays out of hidden markup.** Hidden ranges are atomic (`atomicRanges`), which
  makes the movement keys skip them. That alone does not cover every case, so the view also
  keeps a rule of its own (new; version 1 has none): a position is a *caret stop* if it is not
  strictly inside a hidden range and not before the body of a note with front matter; both
  ends of a widget are stops. In Rich mode, any transaction that sets a selection (a click, a
  key, an undo, a redo, a load, the switch to Rich) has a selection end that is not at a stop
  moved to the nearest stop, the lower one on a tie. Ranges of tables shown as text are
  exempt. The text is never changed by this.
- **A table** is drawn and edited as in 7.7. Writing a cell redraws the table, which is safe
  because a cell is written only when it is left or styled.
- **A photo:** dragging its handle previews the width and, on release, dispatches
  `setImageWidth` with any whole percentage. The view does not scroll.
- **The toolbar is drawn from a command table** (9.4) and from `describe`, or `describeCell`
  while a cell has the focus. It reads nothing else from the DOM. Focus moving to the toolbar
  or the header does not clear `typing`; leaving the editor for anything else does.
- **Speed.** The view parses at most once per transaction. The time of a whole intent is
  measured; if it is over 50 ms three times in a row, the editor says the note is large and
  offers Raw. If the person stays in Rich it keeps working.
- **Raw mode** has Write and Preview tabs; the preview is the rendered note.

## 9. The front end (`web`)

### 9.1 Screens and addresses

| Address | Screen |
|---|---|
| `/login` | Log in |
| `/` | The welcome: "Pick a note, or start a new one", and any drafts found |
| `/n/<id>` | The editor |
| `/n/<id>/history` | Earlier versions: view rendered or raw, restore |
| `/d/<id>` | (SPEC-DRAWINGS) A drawing, in Excalidraw, with the sidebar |
| `/d/<id>/history` | (SPEC-DRAWINGS) A drawing's earlier versions: view, restore |
| `/trash` | Trashed notes: read, restore, empty one or all |
| `/fonts` | The catalogue by name and category, with "Show more"; add and remove fonts |
| `/styles` | Saved styles: rename, edit as text, delete |
| `/account` | Change password, log out, the last backup time (a warning when over two days old) |

`/` and `/n/<id>` share a layout: the sidebar on the left and the screen on the right. The other
screens have a top bar with the same links. A router of about 60 lines over the History API maps
addresses to screens. An unknown address shows "Not found".

### 9.2 Stores

Each is one module of Svelte runes that exports its state read-only and its actions.

| Store | Owns |
|---|---|
| `session` | The user, logging in and out |
| `library` | The list of notes, tag counts, the search text and tag filter |
| `editor` | The open note: id, base revision, saved text, line ending and byte order mark, saving, conflict, mode. The view registers a `getText()` with it; `dirty` is that text compared with the saved text. (SPEC-DRAWINGS) It has a kind: for a drawing it asks the view for the scene, and `dirty` is the drawing's signature compared with its baseline. |
| `drafts` | Unsaved text in local storage; each draft has a kind (SPEC-DRAWINGS; one stored without it is a note's) |
| `styles`, `fonts` | The person's saved styles and fonts, as the server holds them |
| `prefs` | Kept in the browser only: sidebar folded, last mode |
| `toasts` | Messages |

Only store actions call the API client. Components never call `fetch`. The editor's text,
selection and `typing` live in CodeMirror and nowhere else.

### 9.3 The sidebar

The brand, a fold button, **New note**, a search box, tag chips with counts ("All" first), the
list of notes (title, time, tags, and the excerpt when searching; the open one marked), and
links to Trash, Fonts, Styles and Account. Search and tag filter act in place. The fold state is
remembered in the browser. On a screen under 640 pixels the sidebar is the whole home screen;
over a note it is a full sheet, opened by the header's notes button and closed by picking a
note or by its fold button. It scrolls without showing a scroll bar, as does the editor.

### 9.4 The editor's header and toolbar

**Header:** the notes button (shows or hides the sidebar), the title (click to edit), the tags
(chips with a remove mark, and a box that adds a tag on Enter, Tab, space or comma and keeps
the focus; Backspace in the empty box removes the last tag), the save status, the mode button
(one button that shows the current mode, Rich or Raw, and switches to the other), Note
settings, New note, and Save.

**Note settings** opens a row with the note's font and size, and **History** and **Move to
trash**.

**Toolbar,** in this order, the same in both modes:

| Control | Notes |
|---|---|
| Font | Serif, Sans, Mono and the person's fonts |
| Size | `−`, a number box, `+` |
| Bold, italic, underline, strikethrough, inline code | Lit when all of the selection has it. Turns the style on if any selected character lacks it, off otherwise. |
| Text colour, highlight | The twelve of each in `PALETTE` and `HIGHLIGHTS` of `app/web/src/toolbar.ts` (copied to `web/src/palette.ts`), and "None" |
| Link | A small panel: address, open, remove |
| Block style | Normal text, Heading 1 to 6, Quote, Code block |
| List | No list, Bullets, Numbers, Tasks |
| Insert | Photo, Table, Horizontal line |
| Styles | Shows the matching saved style's name, else "Styles". The list starts with "Default (reset)"; a box saves the current style under a name. |

Keys: Ctrl+S, Ctrl+Z, Ctrl+Shift+Z, Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+Shift+X, Ctrl+K, Ctrl+Shift+.
and Ctrl+Shift+, (size), Ctrl+\ (clear formatting). Controls that cannot apply are greyed out.
Under 640 pixels the header is two rows and the toolbar wraps into three; nothing scrolls
sideways, and a menu or panel opened from the toolbar spans the screen.

"Default (reset)" with a selection clears its formatting. With none it sets `typing.marks` to
plain text at the size the block gives, so a heading keeps its size.

The command table has one row per control: its id, label, icon, key, the intent it sends, and
how its state is read from `ToolbarState`. The toolbar, the keymap and the tests use the table.

### 9.5 Conflicts and drafts

- **409 on save:** the text is kept and two choices are shown. **Keep mine** saves again from
  the newer revision. **Take theirs** loads the newer text and first stores the person's text
  as a draft, shown in a box to copy.
- **410 or 404 on save:** the text is kept and "Save as a new note" is offered.
- **Drafts.** A draft is stored a moment after typing stops, under user id, note id and a
  random editor id made when the editor opened; it holds the text, the base revision and the
  time. If the browser refuses the write (storage is full), a warning stays on screen until a
  write succeeds. After a save the draft is removed only if the editor's text is what was
  saved. Opening a note offers every draft found for it: "Unsaved text from 14:02 was found.
  Open it or discard it." Opening one stores it under the current editor id before the old
  entry is removed, and takes the draft's base revision, so the next save meets the ordinary
  409 choice if the note has moved on. The home screen lists drafts; for a note that is gone
  it offers "Save as a new note" or discard. A draft never expires by age. Logout removes the
  user's drafts after a warning and tells the browser's other tabs, which show the login.
- Leaving a note with unsaved changes asks first.
- (SPEC-DRAWINGS) A drawing's draft is its file with `files` empty, and its kind. Opening one
  takes the images from the file read from the server; Take theirs keeps the person's scene as
  such a draft; the home screen offers "Save as a new drawing" for a gone drawing's draft.

### 9.6 Rendering

History, Trash and the Raw preview render with `noteformat`'s `renderNote`, then DOMPurify
(keeping `style`). An image whose path is `note.assets/<file>` is loaded from the note's or
the trash's asset route; any other image is a placeholder. Links to other sites open in a new
tab with `rel="noopener noreferrer"`. Code is not syntax-highlighted.

## 10. Design tokens and CSS

- `web/src/styles/tokens.css` is the only file that holds a colour, a font family, a font size,
  a space, a radius, a shadow or a z-index **of the app's own screens**. It defines them as
  custom properties on `:root`, with the dark values under
  `@media (prefers-color-scheme: dark)`. The app follows the device.
- Layers, in order: `@layer reset, tokens, base, components;`. `base` holds element defaults and
  the note theme (`noteformat/theme/paper.css`, with its variables mapped to tokens).
- Every component's styles are in its own Svelte `<style>` block and use only `var(--…)` for
  those kinds of value. CodeMirror's theme, written in TypeScript, does the same. A Stylelint
  rule fails the build on a raw colour, on `!important`, and on any of those values written
  outside `tokens.css`; a small script applies the raw-colour rule to `*.ts` in `web`.
- **A note's own content is exempt:** the inline styles `noteformat` writes for colours, fonts
  and sizes, the person's fonts, the note theme file `paper.css`, and one data file,
  `web/src/palette.ts`, that holds the twelve text colours and twelve highlights of the
  toolbar. These are the note's, not the app's.
- **No gradients** anywhere.
- **Primitives** used by every screen: `Button` (primary, plain, quiet, danger, icon), `Field`,
  `Select`, `Chip`, `Menu`, `Popover`, `Dialog`, `Toast`, `Icon`. A screen composes these and
  adds layout only.
- **The look** is version 1's current one: the accent violet `#6d3bf5` (dark `#a48bff`) with its
  strong and soft shades; the pale sidebar `#f7f7f9`; the accents pink `#f0388f`, orange
  `#ff8a1f`, yellow `#ffcf33`, green `#10b981` and sky `#1c9bf0`; six tag hues. These values are
  copied from the block headed "The look: light and airy" in `app/web/src/style.css`.
- **Type:** Instrument Sans for controls and Bricolage Grotesque for names and titles, both
  bundled with the app. The note's own text uses the note theme's fonts.

## 11. Fixed test ids

The owner checks the finished app with tests the builders do not see. Those tests find things
only by these `data-testid` values, so they are part of the contract. Labels, classes and layout
may change freely.

- **Login and account:** `login-username`, `login-password`, `login-submit`, `login-error`,
  `password-current`, `password-new`, `password-submit`, `logout`.
- **Sidebar:** `sidebar`, `sidebar-fold`, `new-note`, `search`, `tag-chip` (with `data-tag`),
  `note-row` (with `data-id`), `nav-trash`, `nav-fonts`, `nav-styles`, `nav-account`.
- **Header:** `notes-button`, `note-title`, `tag-input`, `tag` (with `data-tag`), `tag-remove`,
  `save`, `save-status` (with `data-state`: `saved`, `dirty`, `saving` or `error`),
  `mode-toggle`, `note-settings`, `note-font`, `note-size`, `note-history`, `note-trash`.
- **Editor:** `editor` (the CodeMirror root, with `data-mode`), `tab-write`, `tab-preview`,
  `preview`, `photo-input` (the file input), `photo` and `photo-handle`, `table`, `table-cell`
  (with `data-row` and `data-col`), `table-add-row`, `table-add-column`, `table-remove-row`,
  `table-remove-column`, `table-as-text`, `task-box`, `link-address`, `link-remove`.
- **Toolbar:** one `cmd-<id>` for each row of the command table: `cmd-font`, `cmd-size`,
  `cmd-size-down`, `cmd-size-up`, `cmd-bold`, `cmd-italic`, `cmd-underline`, `cmd-strike`,
  `cmd-code`, `cmd-color`, `cmd-bg`, `cmd-link`, `cmd-block`, `cmd-list`, `cmd-insert`,
  `cmd-styles`. Every choice inside a menu or panel is `menu-item` with `data-value` (for
  example `h2`, `bullet`, `table`, `red`, `none`, a style's name). `style-name` and
  `style-save` are the box and button that save a style.
- **Messages:** `toast`, `confirm`, `cancel`, `conflict-mine`, `conflict-theirs`, `save-as-new`,
  `draft-row`, `draft-open`, `draft-discard`.
- **Other screens:** `history-row` (with `data-version`), `history-restore`, `trash-row` (with
  `data-id`), `trash-restore`, `trash-empty-one`, `trash-empty-all`, `font-row` (with
  `data-slug`), `font-add`, `font-remove`, `style-row` (with `data-name`), `style-text`,
  `style-rename`, `style-delete`.

Every build sets `window.__notes = { text(), select(from, to), intent(i) }` on the editor
screen, so a test can read the raw text and drive the core without knowing the layout.

(SPEC-DRAWINGS 7) Also: `new-drawing` in the sidebar; `note-row` and `trash-row` carry
`data-kind` (`note` or `drawing`); `drawing` is the element Excalidraw is mounted in, with
`data-ready="true"` once the drawing is ready. The drawing screen's header uses `notes-button`,
`note-title`, `tag-input`, `tag`, `tag-remove`, `save`, `save-status`, `note-history` and
`note-trash`; its history screen uses `history-row` and `history-restore`. On the drawing
screen `window.__drawing = { text(), addText(text, x, y), setBackground(colour),
addImage(file) }`.

## 12. Tests the builders write

| Level | What | How |
|---|---|---|
| `core` ported tests | Version 1's tests named in 7.1, with their expected results unchanged except for size stepping | As they are, against the ported routines, before anything else is built |
| `core` scenarios | Every intent through `reduce`; every row of both tables of 7.5; every bullet of 7.6 and row of 7.2 marked new; every `tableEdit`; an edit outside its region refused | Text with a caret marker, an intent, the expected text and caret. Pure strings, in Node. Example: `- one¦` + `enter` gives `- one\n- ¦`. |
| `core` properties | Random notes and random intents | The result always parses; `edit` lies inside the intent's region (7.4) and bytes outside it are unchanged; applying `edit` to the old text gives the new text; a setting intent (`setMark` other than `size-step`, `setBlock`, `setList`, `setLink`, `setMeta`) applied twice gives the same text as once. |
| `core` bytes | `load` then `serialize` without edits | The same bytes, for LF, CRLF and a BOM. Mixed endings and a lone CR become LF. |
| Editor state | Undo and redo after each kind of intent, and typing grouped into one step; composition, including one that replaces a selection and one that is refused; `typing` cleared by a key move and kept by a click; the caret kept at stops after undo and a mode switch; what version 1's `rich-display` test checked | CodeMirror's `EditorState` in Node, no browser |
| `server` | Every route and every refusal; each operation of 4.3 stopped after each step and restarted; two users cannot reach each other's notes, history, trash, photos, fonts or styles; path attacks on every id, version, file and slug | `fastify.inject` on a temporary folder |
| `web` stores | Save, 409, 410, a save in flight, a queued save, drafts across two editors, storage full | In Node with a fake API client |
| `e2e` | Seven journeys under the real policy: typing by composition (an IME), right after ordinary typing and over a selection, then undo; log in and create; type and style in Rich, switch to Raw, save, reload; upload and resize a photo; edit a table; conflict in two tabs; trash and restore | Playwright, by test id only |

Every bug found later becomes a `core` scenario before it is fixed.

(SPEC-DRAWINGS 8) The tests of the policy's text check the policy of SPEC-DRAWINGS 3.2, and
that the page still carries a fresh `csp-nonce` each time. Drawings add their own tests at each
level (`core/test/drawing.test.ts`, `server/test/drawings.test.ts`,
`web/test/drawings.test.ts`, `e2e/drawings.test.ts`).

## 13. Running it

One `compose.yaml` for the VPS and a developer's machine: `app` (the Node process; code at
`/opt/notes`; port not published), `caddy` (HTTPS, HSTS, bodies at most 27 MB) and `backup`
(`restic`, run nightly by a timer on the host; it shares the data volume and the admin socket
with `app`). Settings come from `.env`. With the site address `localhost` Caddy uses its own
certificate.

The nightly backup, run in the `backup` container:

1. Remove `/srv/notes/snapshot/` if an earlier run left it.
2. `notes-admin pause-writes`: the server takes every lock. The pause ends by itself after two
   minutes. Requests that need a lock wait for it; none is refused.
3. Make a hard-link copy of `/srv/notes` in `/srv/notes/snapshot/`, without `snapshot/`,
   `config/sessions/`, `cache/` and every `tmp/`.
4. `notes-admin resume-writes`. It reports whether the pause was still in force. If it was
   not, the script removes the copy and stops with an error.
5. `restic` sends the copy to encrypted storage outside the VPS, keeping 30 daily and 12
   monthly snapshots. The copy is then removed.
6. Only after step 5 succeeds, `notes-admin backup-done` records the time.

Because the app never changes a file in place, the copy stays as it was. A file edited in place
by hand during the upload can reach that night's backup half-written; this is accepted and
stated in the README, which also gives the restore steps.

## 14. Build order

1. `contract`: patterns, limits, shapes, routes.
2. `core`: port version 1's routines and their tests (7.1) and make them pass; `load` and
   `serialize`; then `reduce`, the region rule and `describe` around them, with the scenario
   runner; then the rules of 7.2 moved in from version 1's browser code.
3. `server`: storage (`space`), notes and history, trash, accounts and sessions, photos,
   fonts, styles, the admin command.
4. `web`: tokens and primitives; stores and router; login and account; sidebar; the editor in
   Raw with save, conflicts and drafts; Rich decorations, `dispatchIntent`, the filter and
   composition (try this early, on a phone too); toolbar and header; photo and table widgets;
   history, trash, styles, fonts.
5. `e2e`, Docker, README.

## 15. Open questions

None. The owner confirmed the five changes of 1.3 on 2026-11-12. The second follows from the
first: with a note stored as `notes/<id>/note.md` there is no file name to rename.

## 16. What changed since each earlier draft

### Since draft 4, from the fourth review (five reviewers, editor sections only)

Two reviewers judged draft 4 ready with changes; the others' blockers were specific and are
fixed here:

- A cell that cannot be shown as runs is written as Markdown (`setCellSource`); an unchanged
  cell is not written; unsaved cell text travels with the operation that follows it; a style
  with nothing selected applies to the whole cell; cell offsets count code points (7.7).
- A line-start shortcut is its own intent, `shortcut`, wrapping `lineShortcut` (7.3).
- Composition gets a history boundary before it starts, is finished after CodeMirror's last
  update rather than on a timer, and has a browser test (section 8, section 12).
- The region rule says what a block's extent is and what happens at the ends of the text and
  with empty front matter (7.4).
- Non-typing intents are isolated in the history on both sides; caret stops are enforced on
  every selection change and named as new (section 8).
- Corrections of summary to code: Shift+Enter, Backspace under a table, forward Delete, the
  rows that were marked "ported" without a test, fonts not removed when equal to the note's,
  how a link is edited, names and index types of several routines (7.3, 7.5, 7.6).

### Since draft 3, from the third review (five reviewers, editor sections only)

Every finding was a place where the spec's summary of the editor differed from version 1's
code or tests, or promised something that code does not do. Each was corrected to the code:

- The test expectations that change are named (size stepping only); the tests that cannot be
  `core` tests are named and moved (7.1).
- Rules that version 1 keeps in its browser code are listed and move into `core` (7.2).
- Shapes follow version 1's: one `edit` found by prefix and suffix, `size-step`, toggling
  routines behind value-setting intents (7.3).
- The wrapper adds one rule, that the edit stays in its region; the checks themselves are the
  routines' own (7.4). `touch`, `caretStops` in `core` and `doc.cell` are gone.
- 7.5 was corrected row by row: quotes, heading splits, the start of a list item, Backspace
  under a code block or table, photos, Shift+Enter, the space dropped at a split, which block's
  attribute line refuses a join.
- Shortcuts are `#` to `####`; typed text has three encodings; a click keeps `typing`; Enter's
  carry is `styleToCarry`'s (7.4, 7.6). `setMeta` is `writeSetting` as tested (7.6).
- **Tables keep version 1's way** (7.7): the browser edits the focused cell and the cell is
  written as one intent when it is left. Draft 3's intent per keystroke in a cell was new and
  unproven, and is withdrawn.
- Composition reads the composed text by position, not by difference, and is one undo step by
  CodeMirror's own joining rule; history grouping is stated in user events (section 8).
- A table shown as text is exempt from the Rich handlers and from caret snapping (section 8).

### Since draft 2, from the second review by 21 agents (`spec2-reviews-2/`)

Section numbers in this list are draft 3's.

- Version 1's editing routines and their tests became the definition of editing behaviour.
- `−` and `+` can be expressed; what a block "already gives" is defined from the note's size.
- The filter only drops; input becomes an intent in named handlers. Dropped text, multiple
  selections and the default editing keymap are out of Rich mode.
- Front matter is hidden and atomic in Rich mode; title and tag edits are undo steps.
- Bytes: how the byte order mark and line endings travel through the API and the store (4.4).
- A queued save is dropped on a conflict; a late answer still clears its draft (4.4).
- Smaller: the font stylesheet on the login screen, `tag` with `q`, requests during a backup
  pause, how a restore gets its revision, the palette's data file, the backup's hard links.


### Since draft 1

Section numbers in this list are draft 2's.

From the review by 23 agents (`spec2-reviews-1/`):

- "Version 1" is defined as the running app, and its differences from the old documents are
  listed (1.2), so they are no longer read as dropped features.
- The check is no longer one rule for every intent; each kind has its own (7.2).
- Undo, redo, composition and loading pass the Rich-mode filter by stated rules (section 8).
  `replaceRange` and `cut` were added. `reduce` returns small edits and its parse.
- Raw typing is stated as outside the intent path (section 2).
- A save sends raw bytes with `If-Match`, so a 2 MB note always fits. The second read before
  replacing was removed and the risk stated (4.4, 4.5).
- Line endings: `load` and `serialize`, LF inside the editor (4.4).
- The format's `id` and file-name fallback are reconciled with folder identity (4.2).
- Temporary folders for shared files; history is a new file, never a link; syncing rules (4.1).
- Restored from version 1: search excerpts, the broken front matter guard, photo pixel limits,
  session cookie renewal and clean-up, the password and `remove-user` rules, the draft
  adoption rule and the storage-full warning, font browsing by category, the backup's failure
  rules.
- Error answers and status codes, the page and bundle routes, and the nonce's path are defined
  (sections 5 and 6). Renaming a style is one request.
- The tables of 7.4 have no blank cells. `setMeta` has a written procedure (7.5).
- Styles and fonts have their own stores (9.2). Tokens apply to the app's screens, not to note
  content (section 10). Missing build tools were added (section 3).
- Test ids cover every screen and menu choice, and `window.__notes` is in every build (11).
- The false "same intent twice" property was replaced (section 12).

Not taken: dropping the in-memory index (search needs the text); one asset route for notes and
trash; marking live tabs so that their drafts are not offered (version 1's rule is kept).
