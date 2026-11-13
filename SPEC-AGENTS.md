# Nook agents: specification

Draft 2, 2026-11-12. Not built. Section 14 says what changed since draft 1.

This document adds an interface for AI agents to the app that `SPEC2.md` and
`SPEC-DRAWINGS.md` describe. Where it is silent, those documents apply. "SPEC2 4.4" means that
document's section 4.4; "DRAWINGS 4.2" means `SPEC-DRAWINGS.md`'s.

An agent here is a program on one of the owner's machines (a command-line coding agent with a
shell and `curl`) that a person has given a token. With the token it can list, read, create and
save that person's notes and drawings over HTTP. It cannot delete anything.

## 1. Decisions

### 1.1 Made by the owner on 2026-11-12

1. **Agents use an HTTP interface,** not the web app's controls.
2. **Agents create and save notes and drawings. They never delete.**
3. **A simpler form for drawings is in this version** (section 6): an agent sends a short list
   of shapes and arrows, and the server makes the Excalidraw file.

### 1.2 Proposed, for the owner to confirm

Nine AI models were asked what interface an agent would want, and eight of them then reviewed
draft 1 against the code. Where they agreed, this draft follows them.

4. **Plain HTTP only.** No command-line tool and no MCP server in this version. Either can be
   added later as a wrapper that holds no rules of its own.
5. **An agent has its own token,** made by a person in the web app, named, revocable, and tied
   to that person's space. It is not a password and not a session.
6. **Agent routes are a separate set** under `/api/agent/v1`. A token works there and nowhere
   else. A session cookie works everywhere else and not there. The set has no route that
   deletes, trashes, restores, empties, or touches photos, fonts, styles or accounts. "No
   delete" is this absence, enforced by the server (section 3).
7. **An agent's request never removes a version a person wrote** (4.3). Agents' versions are
   kept in a folder of their own with a small limit of their own (10 for a note, 5 for a
   drawing), and where the server cannot be sure who wrote something, it is a person's.
8. **Saving is whole-document, as now, plus append for notes** (5.6). No patching.
9. **Who wrote what is recorded by the server, outside the file** (4.2). The note format and
   the drawing file do not change.
10. **An agent can read history** but not restore through it; to undo, it saves the old text.
11. **Changing or resetting a password revokes that person's tokens,** as it ends their other
    sessions.
12. **There are limits on how much agents can write** (3.3), so a runaway agent cannot fill
    the disk.

### 1.3 Not in this version

A command-line tool. An MCP server. Photos added or read by an agent. The trash. Patching.
Keys that make a repeated create harmless (`Idempotency-Key`). Paging of the list. Telling the
open web app that an agent changed something (the person sees it on the next list or save).

## 2. Tokens

### 2.1 What a token is

- A token is `nook_` followed by 40 characters of lower-case base-32 (200 random bits), made
  with the server's random source.
- The server keeps only its SHA-256, in `config/agents.json` (`DataLayout.agentsFile`),
  written under the accounts lock by SPEC2's rule for `users.json` and kept in memory. A
  record is `{ id, userId, name, hash, created, used }`: `id` is 16 base-32 characters;
  `created` is an ISO date-time; `used` is the ISO date-time of the last request or `null`,
  written at most once an hour.
- **The name** is trimmed first, then must be 1 to 40 characters with no control characters
  (`PATTERNS.styleName`), and unique among one person's tokens, compared without case.
- A person may have at most 20 tokens (`LIMITS.agents`).
- **A token is good only while its user exists.** Looking a token up also looks the user up
  (`byId`), as a session does.
- **Removing a user** removes that user's tokens first and writes `agents.json`, then removes
  the user as now. A crash between the two leaves a user without tokens.
- **Changing a password and `reset-password`** remove all that user's tokens, in the same
  locked step that ends the sessions. The Account screen says so before the change.
- `config/` is already in the backup, so the hashes are.

### 2.2 Making and revoking, in the web app

Three routes for the browser, with a session and the `Origin` check as every other:

| Route | Body | Answer |
|---|---|---|
| `GET /api/agents` | none | `{ agents: [{ id, name, created, used }] }` |
| `POST /api/agents` | `{ name }` | 201 `{ agent, token }`; 409 `name-taken`; 409 `limit` at 20; 400 for a bad name |
| `DELETE /api/agents/:id` | none | `{}`; 404 for another person's or none |

The token is in the answer to `POST` once and is never shown again.

The Account screen gains a section, **Agents**: the list (name, when made, when last used),
a field and a button to make one, and **Revoke** on each row, which asks first. After making
one, the screen shows the token with a **Copy** button, the address of the guide (5.1) and a
line saying it will not be shown again; it stays until the person closes it.

## 3. The boundary

### 3.1 Three ways to be let in

`RouteDef.auth` changes from a boolean to `"session" | "token" | "none"`, and `app.ts` passes
it to each route's config.

- `"none"`: login and the guide (5.1). No check.
- `"session"`: every route that has `auth: true` today. The `preHandler` looks only at the
  cookie. A request with a token and no cookie is 401, as now.
- `"token"`: every route of section 5 but the guide. The `preHandler` reads
  `Authorization: Bearer <token>` and never the cookie. A missing or malformed header, a
  token whose hash is not in the table, or one whose user is gone, is 401 `no-token` with a
  hint naming the guide's address. The user is the token's.

### 3.2 The `/api/agent/` addresses

- **The `Origin` check does not apply** to a request whose path begins `/api/agent/`, whether
  or not a route matches (a program sends no `Origin`, and no browser sends the token by
  itself). It applies to every other request as now.
- **An address or method under `/api/agent/` that is no route** is 404 `not-found` with a hint
  naming the guide, from the not-found handler, never 403 or 405.
- **No route in the set deletes.** The set is exactly section 5. None has the method
  `DELETE`.
- The body-type check of `onRequest`, the 64 KB limit on JSON, the response headers and the
  log line apply as to other routes. The log never holds a token.

### 3.3 Limits on what agents write

Counted per person, across all that person's tokens, in memory (a restart clears the counts):

- at most 60 changing requests in any minute (`LIMITS.agentChanges`);
- at most 300 MB of request bodies in any 24 hours (`LIMITS.agentBytesPerDay`).

Beyond either, 429 `busy` with a hint saying when to try again. Reading is not limited.

**A save that empties.** An agent's save or create is 422 `empty` when the note's text after
its front matter is only white space, or when a drawing that has elements would be left with
none. (An empty note can still be made by create with no body, 5.5.)

**A save that drops images.** An agent's save of a drawing is 422 `missing-image`, naming the
file id, when an image element that is not deleted names a file that `files` does not hold.

### 3.4 Tests that hold the boundary

For every route with `auth: "session"`: a request that is otherwise valid (a good `Origin`, a
valid body) with a good token and no cookie is 401, and nothing on disk changes. For every
route with `auth: "token"`: a good cookie without a token is 401. No route under
`/api/agent/` has the method `DELETE`; `DELETE` on each agent address, with no `Origin` and
with a foreign one, is 404. A token reaches only its own person's items.

## 4. Who wrote what

### 4.1 What a person sees

- `Entry` gains `agent: string | null`: the name of the agent whose request wrote the main
  file as it is now, or `null`. `HistoryEntry` gains `agent: string | null` likewise for the
  text that version holds. (`TrashEntry` does not change.)
- The name is copied when the write is made; revoking the token later does not change it.
- **Sidebar:** a row whose `agent` is not null shows a small mark beside the time, with the
  name as its title.
- **Editor and drawing screens:** the header says "Written by *name*" beside the save status.
- **History screens:** a version an agent wrote says so, with the name.
- When a person's save changes the file, `agent` becomes `null`. A person's save of the same
  bytes writes nothing (SPEC2 4.4, step 4) and the mark stays: the bytes are still the
  agent's. A person's restore of a version is a person's save.

### 4.2 Where it is kept

Two things in the item's folder:

```
users/<user-id>/notes/<id>/
  note.md
  history/<version>.md             a person's versions, as now
  agent-history/<version>.md       agents' versions
  writers.json
```

- **`agent-history/`** holds the versions whose text an agent wrote. Which folder a version
  is in is the only thing that decides whether a request may remove it (4.3).
- **`writers.json`** is
  `{ "current": { "agent": "claude on the laptop", "revision": "<sha-256>" } | null, "versions": { "<version>": "<name>" } }`.
  `current` says who wrote the main file, and counts only while `revision` equals the
  revision of the main file's bytes. `versions` gives the name for each file in
  `agent-history/`.
- **Whatever cannot be shown to be an agent's is a person's.** The main file is a person's
  when `current` is null, when its `revision` does not match (a hand edit, SPEC2 4.5, or a
  crash), or when `writers.json` is missing or not valid JSON of this shape. A version in
  `agent-history/` without a name in `versions` is shown as written by "an agent".
- Both move with the folder to the trash and back, and into the backup, with no new step.
- `layout.ts`: `NotePart` gains `"writers.json"` and `"agent-history"`, and a version part
  becomes `{ version, kind, agent: boolean }`; `notePath` handles each (the two names join
  its list of literal parts).
- The index reads `writers.json` whenever it reads the main file.

### 4.3 Saving, with a writer

SPEC2 4.4's steps, for every save (a person's too), with these changes. "The old text is an
agent's" means `current` counts (4.2) for the bytes read in step 2.

- **Step 5:** the old bytes go to a new version *v*, in `agent-history/` if the old text is
  an agent's, in `history/` otherwise. *v* must be a name in neither folder.
- **Step 5a, new:** `writers.json` is replaced by rule 3. `versions[v]` is the old agent's
  name if the old text was an agent's. `current` is `{ agent, revision }` of the bytes about
  to be written when an agent is saving, or `null` for a person.
- **Step 6:** the main file is replaced, as now.
- **Step 7** becomes:
  - **An agent's request** removes the oldest files of `agent-history/` beyond the newest 10
    (`LIMITS.agentHistory`; 5 for a drawing, `LIMITS.agentDrawingHistory`). It removes
    nothing from `history/`, ever.
  - **A person's request** does that, and also removes the oldest files of `history/` beyond
    the newest 50 (20 for a drawing), as now.
  - The names of removed agents' versions leave `versions` in one more write of
    `writers.json`; a crash before it leaves names without files, which are ignored.

What follows:

- An agent's first save after a person's puts the person's text into `history/` and removes
  nothing, so `history/` can hold 51 (21) until the person's next save. That next save
  removes the oldest, exactly as the person's own save would have had the agent never run.
- **Every crash errs toward a person.** After step 5a and before step 6, `current.revision`
  does not match the main file, so the main file counts as a person's. An agent's text can be
  taken for a person's (and so kept longer); a person's is never taken for an agent's.
- A create by an agent writes `writers.json` in the new folder before the folder is moved
  into place.

History routes list both folders together, newest first; a version is read from whichever
folder holds it.

On disk a note can now hold 60 versions and a drawing 25 (of up to 25 MB each).

## 5. The interface

All addresses below are under `/api/agent/v1`. Answers are JSON unless said. "Item" means a
note or a drawing. Every answer that describes one item has `url`: the item's page in the web
app (`/n/<id>` or `/d/<id>`), for the agent to give its person.

**The server's own address,** in `url` and in the guide, is the scheme and `Host` of the
request itself, read as the `Origin` check reads them. Nook answers on more than one address
(a name, an IP address), and this gives back the one the agent used.

### 5.1 The guide: `GET /api/agent/v1`

`auth: "none"`. It answers `text/markdown`: a page an agent can read once and work from, with
this server's address in every example. It holds:

- what an item is, the two kinds and their body types, the limits (2 MB, 25 MB), the tag
  pattern (so `meeting-notes` and `2026` are not tags), the id pattern;
- each route of this section with one `curl` example and its answer;
- how to change a note: read, edit the text, save with the revision; what to do on 409;
- that append without `If-Match` must not be sent again blindly when its answer is lost:
  read the note and look first, or use `If-Match`;
- how to undo: read history, and save the old text;
- for drawings: use the short form (section 6) to make one; to change one, read it, change
  the JSON, and save all of it, `files` included, or its images are refused as missing;
- that a note's photos are lines such as `![](note.assets/…)`, which an agent keeps as they
  are and cannot open;
- a complete small note, a complete short-form drawing, and a complete Excalidraw drawing;
- every error code of 5.8 with what to do about it;
- what a token cannot do, said plainly, so an agent does not go looking: delete, trash,
  restore, photos.

The page's text is one file in the repository, `packages/server/src/agent-guide.md`, with the
address filled in when it is served. A test runs every `curl` example in it against a real
server, and an `e2e` case opens both example drawings in the browser.

### 5.2 List and search: `GET /items?tag=&q=`

As `GET /api/notes`: `{ entries, tags }`, both kinds, newest first, with `agent` in each
entry.

### 5.3 Read: `GET /items/:id` and `GET /items/:id/text`

- `GET /items/:id` answers `{ text, revision, entry, url }`. `text` is the whole file: for a
  note the Markdown with its front matter; for a drawing the Excalidraw JSON.
- `GET /items/:id/text` answers the file's bytes themselves, with the type of its kind and
  `ETag: "<revision>"`, so that `curl -o` gives a file to edit and send back.

A file that is not valid UTF-8 is 422 `not-utf8`, as now.

### 5.4 History: `GET /items/:id/history` and `GET /items/:id/history/:version`

As the browser's two routes: `{ versions }` with `agent` in each, and `{ text }`. Reading
only. There is no restore: to bring a version back, the agent saves its text (5.6).

### 5.5 Create: `POST /items?title=&tags=`

A route of its own (the browser's `POST /api/notes` is not reused: no JSON form, no `from`).

- The body is the document, with the type of its kind: `text/markdown` for a note,
  `application/vnd.excalidraw+json` for a drawing, or the short form of section 6. A request
  with `text/markdown` and no body makes an empty note.
- `title`, if given and not empty, is trimmed and must be at most 300 characters with no
  control characters, or the request is 422 `bad-title`. `tags` is a list separated by
  commas; empty parts and repeats are dropped; each other part must match the tag pattern, or
  the request is 422 `bad-tag` naming it.
- **A note.** The body is first checked as a save is (so broken front matter is 422
  `broken-front-matter`). "Has front matter" means `parseNote(text).frontMatter` is not
  null.
  - Without front matter: the server puts front matter before the body: `title` if given,
    `tags` if given, `created` (today). With no `title` none is written, and the note's title
    is its first heading by the rules it has now.
  - With front matter: stored as sent; `title` or `tags` in the address is then 400 with a
    hint to put them in the document.
- **A drawing.** Without a `nook` key the server parses the JSON, adds
  `nook: { title, tags, created }` (`title` is `Untitled N` by SPEC2 4.3 when none is given),
  and writes the object with a two-space indent, its other keys and their order as sent.
  With a `nook` key of any shape it is stored as sent, and `title` or `tags` in the address
  is 400.
- This is the one place the server writes bytes other than those sent (SPEC2 4.4 and
  DRAWINGS 4.2 say it never does, of a save; that stays true of a save).
- The size limit of the kind is checked again on the bytes to be written.
- The answer is 201 `{ id, revision, entry, text, url }`.

### 5.6 Save and append

**`PUT /items/:id`** is SPEC2 4.4 as changed by 4.3: the whole document, the type of the
item's kind, `If-Match` with the revision.

- The route declares no header schema. The handler takes `If-Match` with or without quotes;
  when it is missing the answer is 428 `no-revision`; when it is not 64 hex characters, 400.
- Its other refusals are those of `PUT /api/notes/:id`, and 3.3's. The 409 carries `current`
  (`text`, `revision`, `entry`) so the agent can merge and send again.
- The answer is `{ revision, entry, url }`.

**`POST /items/:id/append`**, notes only (a drawing is 415). One function, `space.append`,
does all of it inside one `space.run`, so nothing can come between its read and its write:

- The body is `text/markdown`. An empty body, or one of only white space, is 422 `empty`.
- The line ending is the note's first one, or LF when it has none; the body's line endings
  are changed to it. A byte order mark at the start of the note stays; one at the start of
  the body is dropped.
- The note's trailing white space and line endings are removed; then, unless nothing is left
  after the front matter, one empty line; then the body with its trailing line endings
  removed; then one line ending. So there is exactly one empty line between what was there
  and what was added.
- `If-Match` is optional. With it, a stale revision is 409.
- The result is then a save in every way: checked as a save is (so a note whose front matter
  is already broken is 422 `broken-front-matter`, with a hint that a person must mend it),
  the size limit on the whole result, the history step, the writer, the answer of `PUT`.

### 5.7 What is not here

There is no way to trash, to restore, to add or read a photo, or to see another person's
items. An item in the trash is 410 on every route of this section, with a hint that a person
moved it to the trash and only a person can bring it back.

### 5.8 Errors

An error on a request under `/api/agent/` is the existing body with `hint` inside `error`:

```json
{ "error": { "code": "changed", "message": "The note was changed since you opened it.", "hint": "Read the item again, apply your change to the new text, and save with the new revision." } }
```

`HttpError` gains a hint; the error handler, the not-found handler and the body-type check of
`onRequest` put one on every answer under `/api/agent/` with status 400 or above. A hint says
what to do next in one or two sentences and names the value at fault where the server knows
it (the tag, the header, the size and the limit, the JSON path of a schema error). Where it
does not, the hint is a general one for that status.

| Status | Code | When |
|---|---|---|
| 400 | `bad-request` | The address, a header or a value is wrong; a JSON body that does not match |
| 401 | `no-token` | No token, an unknown one, or one whose user is gone |
| 404 | `not-found` | No such item, version or route |
| 409 | `changed` | The revision is stale |
| 410 | `trashed` | The item is in the trash |
| 413 | `too-large` | Over the kind's limit, or the route's; says the size and the limit |
| 415 | `unsupported-type` | No body type, one that is not the item's kind, or append on a drawing |
| 422 | `refused`, `not-utf8`, `not-json`, `not-excalidraw`, `broken-front-matter` | As a save in the browser |
| 422 | `bad-tag`, `bad-title`, `empty`, `missing-image`, `bad-sketch` | 5.5, 3.3, section 6 |
| 428 | `no-revision` | A save without `If-Match` |
| 429 | `busy` | Over a limit of 3.3 |
| 500, 503 | `server`, `unavailable` | Nothing is known to have been saved: read before sending again |

The most common mistake, `curl -d` with no `Content-Type`, is the 415, and its hint names the
three types.

## 6. The short form for drawings

An agent writing Excalidraw by hand gets the many values of each element subtly wrong. The
short form is a third body type for create, `application/vnd.nook.sketch+json`, which the
server turns into an ordinary `drawing.excalidraw`. It is for making a drawing only: reading
always gives the Excalidraw file, and a save takes only that.

### 6.1 The form

```json
{ "shapes": [ { "id": "a", "type": "rectangle", "x": 0, "y": 0, "label": "Browser" },
              { "id": "b", "type": "rectangle", "x": 320, "y": 0, "label": "Server", "fill": "yellow" },
              { "type": "text", "x": 0, "y": 120, "label": "One save, whole document" } ],
  "arrows": [ { "from": "a", "to": "b", "label": "PUT" } ] }
```

- **A shape** has `type` (`rectangle`, `ellipse`, `diamond` or `text`), `x` and `y` (its top
  left, in pixels, y downward), and optionally `id`, `width`, `height`, `label`, `color` (its
  line and text), `fill`. A `text` must have a `label`. Without `width` and `height` a shape
  is 160 by 60, made larger if its label needs it.
- **An arrow** has `from` and `to`, each the `id` of a shape, and optionally `label` and
  `color`. It is drawn straight, from the edge of one shape to the edge of the other along
  the line between their centres, and bound to both, so it follows when a person moves them.
- **A colour** is one of `black`, `gray`, `red`, `orange`, `yellow`, `green`, `blue`,
  `violet`, or `#rrggbb`.
- **Limits:** at most 500 shapes and 1000 arrows; a label at most 500 characters; numbers
  finite and within ±100000; ids unique, 1 to 40 characters of `A-Z a-z 0-9 _ -`. The JSON
  limit of 64 KB does not apply to this type; the route's does.
- Anything else (an unknown key, a `from` that names no shape, an arrow from a shape to
  itself) is 422 `bad-sketch`, with the JSON path and the reason in the hint.
- `title` and `tags` come from the address, as in 5.5.

### 6.2 The converter

Excalidraw's own converter for such lists (`convertToExcalidrawElements`) cannot be used on
the server: the package does not load in Node (checked on 2026-11-12 with 0.18.1: its import
fails before any code runs). So `packages/core/src/sketch.ts` holds Nook's own, pure and
tested in Node:

- `sketchProblem(value)` gives the first fault and its path, or null.
- `sketchToDrawing(sketch, nook, random)` gives the text of a `drawing.excalidraw` in the
  form of DRAWINGS 4.2: every element with the values the pinned Excalidraw writes for its
  type; a label in a shape as a text element bound to it and centred; an arrow with its two
  bindings and each shape naming the arrow; ids, seeds and nonces from `random`.
- **Text is sized by estimate** (the server has no fonts): a width from the count of
  characters in the longest line, a height from the count of lines.
- The file is marked `nook.sketch: true`.

### 6.3 Opening one

When the drawing screen opens a file with `nook.sketch: true`, it passes the elements through
Excalidraw's `restoreElements` with `refreshDimensions` and `repairBindings` on before giving
them to the component, so every text is measured with the real font and every label sits in
its shape. This happens before the baseline of DRAWINGS 4.3 is taken, so the drawing does not
open unsaved. A person's first save writes the measured sizes; `serializeDrawing` writes only
`title`, `tags` and `created` into `nook`, so the mark goes with that save.

Until a person saves it, the file holds the estimated sizes: in excalidraw.com, or in the
history screen's view, labels may sit a little off. This is accepted.

### 6.4 First step: see it work

Before the rest of section 6 is built, the builder writes the converter for one rectangle
with a label, one text and one arrow, and opens the result in the real drawing screen. The
builder checks, and records in `SPEC-NOTES.md`: that the shapes, the labels and the arrow
show where they should; that moving a shape moves its arrow and its label; that the drawing
opens not unsaved, and after a save and a reload is unchanged; which element values
Excalidraw's `restore` fills in when they are left out, so the converter need not write them.
If `restoreElements` cannot do what 6.3 says, the estimate is made closer and 6.3 is dropped.

## 7. Contract and server

- `contract`: `auth` as in 3.1 on every route; `LIMITS.agents` (20), `agentChanges` (60),
  `agentBytesPerDay` (300 MB), `agentHistory` (10), `agentDrawingHistory` (5), and the limits
  of 6.1; `PATTERNS.agentToken`; `SKETCH_TYPE`; `Agent`; `agent` in `Entry` and
  `HistoryEntry`; the routes of 2.2 and of section 5; `ErrorBody` allows `error.hint`.
- `errors.ts`: `HttpError` takes a hint and puts it in `error`; `CODES` gains 428.
- A new `agents.ts` beside `accounts.ts`: the table, making, revoking, lookup by hash with
  the user check, the hourly `used`, removal with the user and with a password change; the
  counts of 3.3.
- `app.ts`: 3.1 and 3.2 in `onRequest`, `preHandler` and the not-found handler; a parser for
  the short form's type that keeps the raw bytes; the handlers of section 5, which call the
  same `space` functions the browser's routes do, with the writer's name.
- `space.ts`: `save`, `saveAsNew` and `create` take a writer (`string | null`); 4.3;
  `append`; the checks of 3.3; `agent` in the index's facts, `entryOf` and `history`;
  `history` and `version` over both folders. `layout.ts` as in 4.2.
- `core`: `newNoteText` and `yamlQuote` move here from `space.ts` and gain tags (`fmwriter`
  cannot write `created`, so it is not used); a function that adds `nook` to a drawing's JSON
  as 5.5 says; `sketch.ts`.

## 8. The web app

- Account screen: the Agents section of 2.2, and the line about passwords of 2.1.
- Sidebar, editor header, drawing header, the two history screens: 4.1.
- Drawing screen: 6.3.
- The API client gains the three routes of 2.2. Nothing else in the stores changes: an
  agent's save reaches an open note as another tab's would, as a 409 on the person's next
  save, with **Keep mine** and **Take theirs**.
- Test ids: `agents`, `agent-row`, `agent-name`, `agent-make`, `agent-token`, `agent-copy`,
  `agent-revoke`; `written-by` on the two headers; `note-row` and `history-row` gain
  `data-agent` (the name, or absent).

## 9. Tests the builders write

| Level | What |
|---|---|
| `core` | Front matter before a body: with and without a title and tags; quoting. `nook` added to a drawing, the other keys kept. `sketch.ts`: each shape type; default and given sizes; a label; an arrow's ends and bindings; every fault of 6.1 with its path; the same sketch and the same `random` give the same bytes. |
| `server`, tokens | Make, list, revoke; the name's rules and the limit of 20; a revoked token is 401 at once; one person cannot see or revoke another's; removing a user, changing a password and `reset-password` remove the tokens; a token of a removed user is 401; the token is in no log line and only its hash is on disk. |
| `server`, the boundary | 3.4. |
| `server`, the interface | List; both reads, with the `ETag`; history; create of each kind and of the short form, with and without `title` and `tags`, with and without front matter or `nook`; each row of 5.8 with its hint; save, 409 with `current`, 428, a quoted `If-Match`; append with and without `If-Match`, for LF and CRLF notes, an empty note, a note ending in empty lines, a note with broken front matter; 410; each limit of 3.3. Every `curl` example of the guide. |
| `server`, writers | `agent` in entries and history after each mix of person and agent saves. **A note a person saved 50 times, then saved 51 times by an agent, still has every one of the person's versions, by name, and the text the agent first replaced.** The same for a drawing. A person's save after an agent's removes the oldest of the person's beyond 50. A hand edit after an agent's save is a person's. A missing and a broken `writers.json`. A crash after each step of 4.3 is never an agent's text where a person's is. Trash and restore keep both folders. |
| `web` stores | The Agents section through the API client with a fake server. |
| `e2e` | Make a token on the Account screen and copy it; with it, from outside the browser, create a note, an Excalidraw drawing and a short-form drawing; all appear in the sidebar with the agent's mark and open; the short-form drawing shows its shapes, opens not unsaved, and is unchanged after a save and a reload. Append to a note open in the browser, then save in the browser and get the conflict. Revoke, and the next request is 401. |

Existing tests that compare a whole entry gain `agent: null`; those that read `auth` from a
route read the new values. No other existing test changes.

## 10. Build order

1. `contract`: `auth`, the limits, the patterns, the types, the routes.
2. `server`: tokens; the boundary of section 3 and its tests, before any agent route exists.
3. `server`: writers in `space.ts` (4.2, 4.3) for a person's saves, with every existing test
   still passing.
4. `core`: front matter and `nook`. `server`: the routes of section 5, the limits of 3.3, the
   guide without its short-form parts.
5. `web`: the Agents section; the marks of 4.1.
6. The first step of 6.4, and its result written down. Then `sketch.ts`, the short form in
   create, 6.3, and the guide's short-form parts.
7. `e2e`, then `README.md`, `SPEC-NOTES.md`, `PROGRESS.md`, and the changes to `SPEC2.md`.

Steps 1 to 5 are a working interface without the short form.

## 11. Risks

- **A token is a secret in a file on a machine.** Whoever reads it can read every note of
  that person and write to them, until it is revoked. It cannot delete or take the account.
- **An agent can still spoil the current text** with a bad save that is not empty. The
  person's versions are in history, the agent can read history to undo, and the mark of 4.1
  shows that an agent wrote it; nothing stops the save itself.
- **A repeated create makes two items,** and a repeated append adds twice, when the first
  answer was lost. The guide says how to avoid the second.
- **A person editing while an agent saves** gets a conflict on their next save, as with two
  tabs. There is no merge.
- **Disk.** The limits of 3.3 are per day and in memory: over many days, or across restarts,
  agents can still fill a disk, and only a person can remove what they made.
- **A large drawing does not fit in an agent's context.** Reading gives the whole file,
  images included, and saving needs all of it back.
- **The short form's text sizes are estimates** until a person saves the drawing (6.3).
- **Nook's converter follows Excalidraw's format by hand.** An upgrade of Excalidraw is
  checked by opening a short-form drawing, as stored drawings are checked.

## 12. Changes this makes to SPEC2 and SPEC-DRAWINGS

SPEC2 4.2 (two more things in an item's folder). 4.4 (the steps, and what a request may
remove). 4.6 (two folders; a version has a writer). 5 (tokens; three ways to be let in; where
the `Origin` check applies; what a password change ends). 6 (the routes, `auth`, `agent` in
entries, `hint`, 428). 9 (the Account screen; the marks). 11 (the ids of section 8).
SPEC-DRAWINGS 4.2 (`nook.sketch`). 4.4 (agents' versions: 5). 5 (the short form's type).

## 13. Open questions for the owner

1. Decisions 4 to 12 of 1.2 are proposals. The two that change something a person does today
   are 11 (a password change revokes tokens) and 12 (the limits of 3.3).
2. Should an agent be able to read a note's photos? Two reviewers asked for it, so that an
   agent can understand a note with pictures. Adding photos stays out either way.

## 14. Changes since draft 1

**Draft 2.** From a review of draft 1 against the code by eight AI models (a ninth did not
answer), a check of Excalidraw's converter in Node, and one decision by the owner (1.1, 3).

- **History.** Draft 1's promise was false: the first agent save after a person's removed the
  person's oldest version, and a crash, a hand edit or a broken `writers.json` could file a
  person's text as an agent's and let it be removed. Agents' versions now have their own
  folder; an agent's request removes nothing from `history/`; `current` counts only with a
  matching revision; `writers.json` is written before the main file, so a crash errs toward
  a person (4.2, 4.3). All eight found this.
- **Agents' history is smaller:** 10 and 5, not 50 and 20.
- **Three ways to be let in** (3.1), where draft 1 had a flag that could not say "no token"
  for the guide. The boundary tests leave out login and the guide.
- **Unknown agent addresses** are 404 with a hint (3.2); draft 1 would have answered 403.
- **428** needs the save route to declare no header schema (5.6); `hint` is inside `error`
  and comes from three places (5.8); `broken-front-matter` and seven more codes are listed.
- **Limits on volume** (3.3), and refusals for a save that empties or drops images.
- **Create** has its own route; the front matter is built in `core` from `newNoteText`, not
  `fmwriter`; `nook` is added without `serializeDrawing`; titles and tags have rules (5.5).
- **Append** is one locked function with rules for line endings, empty lines, a byte order
  mark and broken front matter (5.6).
- **Reading history** and **reading the raw file with an `ETag`** are added (5.3, 5.4).
- **Tokens** need a living user, and go with a password change or reset (2.1).
- **The short form for drawings is in** (section 6), with Nook's own converter.
- Not taken: `Idempotency-Key`, paging, a public-address setting (5 says why the request's
  own address is used), reading a drawing without its images, photos.
