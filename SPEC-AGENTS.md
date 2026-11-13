# Nook agents: specification

Draft 4, 2026-11-12. Not built. Section 14 says what changed since draft 1.

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
3. **A simpler form for drawings is not in this version.** An agent sends a drawing as an
   ordinary Excalidraw file. Section 6 keeps the design of a short form (a list of shapes and
   arrows that the server turns into a scene), to be built only if agents' drawings come out
   badly.

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

A command-line tool. An MCP server. The short form for drawings (section 6). Photos added or read by an agent. The trash. Patching.
Keys that make a repeated create harmless (`Idempotency-Key`). Paging of the list. Telling the
open web app that an agent changed something (the person sees it on the next list or save).

## 2. Tokens

### 2.1 What a token is

- A token is `nook_` followed by 40 characters of lower-case base-32 (200 random bits), made
  with the server's random source.
- **The server keeps the token** and its SHA-256 in `config/agents.json`
  (`DataLayout.agentsFile`), written under the accounts lock by SPEC2's rule for
  `users.json` and kept in memory. (Decided by the owner on 2026-11-13, after the build: the
  Account screen goes on showing a token, so the server must have it. Until then only the
  hash was kept.) A record is `{ id, userId, name, hash, token, created, used }`: `id` is 16
  base-32 characters; `created` is an ISO date-time; `used` is the ISO date-time of the last
  request or `null`, written at most once an hour. A request's token is looked up by its
  hash. A record written before tokens were kept has no `token`: it still works, and is
  listed with `token: null`. A `token` whose hash is not the record's is listed as `null`.
- **The name** is trimmed first, then must be 1 to 40 characters, none of them U+0000 to
  U+001F or U+007F to U+009F (`PATTERNS.agentName`, a pattern of its own), and unique among
  one person's tokens, compared without case.
- A person may have at most 20 tokens (`LIMITS.agents`).
- **A token is good only while its user exists.** Looking a token up also looks the user up
  (`byId`), as a session does.
- **Removing a user, changing a password and `reset-password`** remove all that user's
  tokens. One function, `Agents.removeForUserLocked(userId)`, does it; it assumes the
  accounts lock is held (the lock cannot be taken twice) and is called inside
  `removeUserLocked`, `changePassword` and `resetPassword`, in each before `users.json` is
  written, where the sessions are deleted. So `agents.json` is written before `users.json`,
  and a crash between the two leaves the old password without tokens, never a new password
  with old tokens. The Account screen says before a password change that it revokes them.
- `config/` is already in the backup, so the tokens are: a copy of the backup holds them.

### 2.2 Making and revoking, in the web app

Three routes for the browser, with a session and the `Origin` check as every other:

| Route | Body | Answer |
|---|---|---|
| `GET /api/agents` | none | `{ agents: [{ id, name, created, used, token }] }` |
| `POST /api/agents` | `{ name }` | 201 `{ agent, token }`; 409 `name-taken`; 409 `limit` at 20; 400 for a bad name |
| `DELETE /api/agents/:id` | none | `{}`; 404 for another person's or none |

A person's own agents are listed with their tokens, every time; never another person's, and
never a hash.

The Account screen gains a section, **Agents**: the address of the guide (5.1) with a
**Copy** button; the list, each row with the agent's name, its token with a **Copy** button,
when it was made and last used, and **Revoke**, which asks first; and a field and a button to
make one. A token stays on its row for as long as the agent exists. A row whose agent was
made before tokens were kept says that its token cannot be shown.

## 3. The boundary

### 3.1 Three ways to be let in

`RouteDef.auth` and `FastifyContextConfig.auth` change from a boolean to
`"session" | "token" | "none"`, and `app.ts` passes it to each route's config.

- `"none"`: every route that has `auth: false` today (login, and the pages, `/assets/*` and
  `/favicon.svg` that `app.ts` registers outside `routes`), and the guide (5.1). No check.
- `"session"`: every route that has `auth: true` today. The `preHandler` looks only at the
  cookie. A request with a token and no cookie is 401, as now.
- `"token"`: every route of section 5 but the guide. The `preHandler` reads
  `Authorization: Bearer <token>` and never the cookie. A missing or malformed header, a
  token whose hash is not in the table, or one whose user is gone, is 401 `no-token` with a
  hint naming the guide's address. The user is the token's.

### 3.2 The `/api/agent/` addresses

"Under `/api/agent/`" means that the request's path, without its query, begins with the
eleven characters `/api/agent/`. `/api/agents` (2.2) is not under it and keeps every check.

- **The `Origin` check does not apply** to a request under `/api/agent/`, whether or not a
  route matches (a program sends no `Origin`, and no browser sends the token by itself). It
  applies to every other request as now.
- **An address or method under `/api/agent/` that is no route** is 404 `not-found` with a hint
  naming the guide, whatever its headers and body: `onRequest` returns at once for such a
  request (no `Origin` check, no body-type check), and the not-found handler answers.
  Fastify answers an unmatched method there too, with 404 and not 405.
- **No route in the set deletes.** The set is exactly section 5. None has the method
  `DELETE`.
- For a route that matches, the body-type check of `onRequest`, the 64 KB limit on JSON, the
  response headers and the log line apply as to other routes. The log never holds a token.

### 3.3 Limits on what agents write

Counted per person, across all that person's tokens, in memory (a restart clears the counts):

- at most 60 changing requests in any minute (`LIMITS.agentChanges`);
- at most 300 MB of request bodies in any 24 hours (`LIMITS.agentBytesPerDay`).

Beyond either, 429 `busy` with a hint saying when to try again. Reading is not limited. A
request is counted when its token has been accepted, before anything else is checked, so a
refused request counts; its bytes are the length of the body sent.

Two refusals apply to an agent's save and append, and never to a person's save or to a
create. Both compare the new document with the one it replaces:

- **A save that empties** is 422 `empty`: a note whose text after its front matter was not
  only white space and would be; or a drawing that had an element not marked deleted
  (`isDeleted` not `true`) and would have none.
- **A save that drops an image** is 422 `missing-image`, naming the file id: an image element
  that is not marked deleted names a file that the new `files` does not hold and the current
  file's `files` does.

### 3.4 Tests that hold the boundary

For every route with `auth: "session"`: a request that is otherwise valid (a good `Origin`, a
valid body) with a good token and no cookie is 401, and nothing on disk changes. For every
route with `auth: "token"`: a good cookie without a token is 401. No route under
`/api/agent/` has the method `DELETE`; `DELETE` on each agent address, with no `Origin`, with
a foreign one, and with a body of an unknown type, is 404. `POST /api/agents` without an
`Origin` is still 403. A token reaches only its own person's items.

## 4. Who wrote what

### 4.1 What a person sees

- `Entry` gains `agent: string | null`: the name of the agent whose request wrote the main
  file as it is now, or `null`. `HistoryEntry` gains `agent: string | null` likewise for the
  text that version holds: `null` for a person's version, the name for an agent's, and the
  words `an agent` for an agent's version whose name is not known (4.2). (`TrashEntry` does
  not change.)
- The name is copied when the write is made; revoking the token later does not change it.
- **Sidebar:** a row whose `agent` is not null shows a small mark beside the time, with the
  name as its title.
- **Editor and drawing screens:** the header says "Written by *name*" beside the save status.
- **History screens:** a version an agent wrote says so, with the name.
- When a person's save changes the file, `agent` becomes `null`. A person's save of the same
  bytes writes nothing (SPEC2 4.4, step 4) and the mark stays: the bytes are still the
  agent's. An agent's save of the same bytes writes nothing either, and leaves the mark as
  it was. A person's restore of a version is a person's save.

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
- **The file is valid** when it is a JSON object whose `current` is `null` or an object with a
  string `agent` and a `revision` of 64 hex characters, and whose `versions` is an object of
  strings. Read in any other state (missing, not a regular file, not JSON, another shape), it
  is as if it were `{ "current": null, "versions": {} }`.
- **Whatever cannot be shown to be an agent's is a person's.** The main file is a person's
  when `current` is null or its `revision` does not match (a hand edit, SPEC2 4.5, or a
  crash). A version in `agent-history/` without a name in `versions` has the name
  `an agent`.
- Both move with the folder to the trash and back, and into the backup, with no new step.
- `layout.ts`: `NotePart` gains `"writers.json"` and `"agent-history"`, and a version part
  becomes `{ version, kind, agent: boolean }`; `notePath` handles each (the two names join
  its list of literal parts).
- The index reads `writers.json` whenever it reads the main file.
- A person who by hand puts back the exact bytes an agent last wrote has a file that counts
  as the agent's: they are the bytes the agent wrote. This is accepted (section 11).

### 4.3 Saving, with a writer

SPEC2 4.4's steps, for every save (a person's too), with these changes. "The old text is an
agent's" means `current` counts (4.2) for the bytes read in step 2.

- **Step 4** (the same bytes: write nothing) is unchanged, for a person and for an agent.
  `writers.json` is not touched.
- **Step 5:** the old bytes go to a new version *v*, in `agent-history/` if the old text is
  an agent's, in `history/` otherwise. *v* must be a name in neither folder.
- **Step 5a, new:** `writers.json` is read and written again by rule 3 with two changes, and
  everything else in `versions` kept: `versions[v]` is the old agent's name if the old text
  was an agent's; `current` becomes `null`. When the file is not valid and neither change
  applies, nothing is written. **If this write fails:** a person's save goes on to step 6
  (its new file cannot match a stale `current`, so it still counts as a person's); an agent's
  save stops with 500 and the main file is not replaced.
- **Step 6:** the main file is replaced, as now.
- **Step 7** becomes:
  - **An agent's request** removes the oldest files of `agent-history/` beyond the newest 10
    (`LIMITS.agentHistory`; 5 for a drawing, `LIMITS.agentDrawingHistory`). It removes
    nothing from `history/`, ever.
  - **A person's request** does that, and also removes the oldest files of `history/` beyond
    the newest 50 (20 for a drawing), as now.
- **Step 7a, new:** `writers.json` is written once more when it has something to change: for
  an agent's save, `current` becomes `{ agent, revision }`, the revision being that of the
  bytes written in step 6; the names of versions removed in step 7 leave `versions`. A
  failure here is logged and the save still answers as done.

What follows:

- **A revision is recorded only after its bytes are the main file.** So after a crash at any
  point, `current` is null or names bytes an agent did write. An agent's text can be taken
  for a person's (and so kept longer); a person's is never taken for an agent's.
- An agent's save over a person's text puts that text into `history/` and removes nothing, so
  `history/` can hold more than 50 (20): one more for each such save, until the person's next
  save that changes the file removes the oldest beyond the limit, as the person's own save
  always has. `agent-history/` never holds more than 10 (5) after a save. There is no fixed
  number for the two together.
- A create by an agent writes `writers.json` in the new folder before the folder is moved
  into place, with the revision of the bytes the server writes (after 5.5 has added front
  matter or `nook`), not of the body sent.

History routes list both folders together, newest first. A version is looked for in
`history/` first, then in `agent-history/`.

## 5. The interface

All addresses below are under `/api/agent/v1`. Answers are JSON unless said. "Item" means a
note or a drawing. Every answer that describes one item has `url`: the full address of the
item's page in the web app (the server's own address, then `/n/<id>` or `/d/<id>`), for the
agent to give its person.

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
- for drawings: to make one, start from the guide's example; to change one, read it, change
  the JSON, and save all of it, `files` included, or its images are refused as missing;
- that a note's photos are lines such as `![](note.assets/…)`, which an agent keeps as they
  are and cannot open;
- a complete small note, and a complete small drawing (two rectangles with labels, a text,
  and an arrow bound to both rectangles) with every value an element needs;
- every error code of 5.8 with what to do about it;
- what a token cannot do, said plainly, so an agent does not go looking: delete, trash,
  restore, photos.

The page's text is one file in the repository, `packages/server/src/agent-guide.md`, with the
address filled in when it is served. A test runs every `curl` example in it against a real
server, and an `e2e` case opens the example drawing in the browser.

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

One function, `space.agentCreate(bytes, kind, title, tags, writer)`, does it; the browser's
`create` and `saveAsNew` are not used.

- The body is the document, with the type of its kind: `text/markdown` for a note,
  `application/vnd.excalidraw+json` for a drawing. The route's body limit is that of the
  browser's create (`DOCUMENT_LIMIT`). A request with `text/markdown` and no body, or a body
  of no bytes, makes an empty note (the refusals of 3.3 do not apply to a create).
- `title`, if given and not empty, is trimmed and must be at most 300 characters, none of
  them a control character (as an agent's name, 2.1), or the request is 422 `bad-title`.
  `tags` is a list separated by commas; empty parts and repeats are dropped; each other part
  must match the tag pattern, or the request is 422 `bad-tag` naming it. Both are checked
  before anything below.
- **A note.** The body is first checked as a save is (so broken front matter is 422
  `broken-front-matter`). "Has front matter" means `parseNote(text).frontMatter` is not
  null.
  - Without front matter: a byte order mark at the start of the body is dropped, and the
    server puts front matter before the body: a `---` line; `title: "…"` if given, quoted as
    `newNoteText` quotes; `tags: [a, b]` if any; `created: <today>`; a `---` line; an empty
    line. Its line endings are the body's first one, or LF when the body has none. With no
    `title` none is written, and the note's title is its first heading by the rules it has
    now.
  - With front matter: stored as sent; `title` or `tags` in the address is then 400 with a
    hint to put them in the document.
- **A drawing.** Without a `nook` key the server parses the JSON, adds
  `nook: { title, tags, created }` as the last key (`title` is `Untitled N` by SPEC2 4.3 when
  none is given), and writes the object with a two-space indent and a final line break, its
  other keys and their order as sent. `serializeDrawing` is not used: it would drop parts of
  the scene. With a `nook` key of any shape it is stored as sent, and `title` or `tags` in
  the address is 400.
- This and append (5.6) are the two places the server writes bytes other than those sent
  (SPEC2 4.4 and DRAWINGS 4.2 say it never does, of a save; that stays true of `PUT`).
- The size limit of the kind is checked again on the bytes to be written.
- The answer is 201 `{ id, revision, entry, text, url }`.

### 5.6 Save and append

**`PUT /items/:id`** is SPEC2 4.4 as changed by 4.3: the whole document, the type of the
item's kind, `If-Match` with the revision.

- The route declares no header schema and has the body limit of the browser's save. The
  handler takes `If-Match` with or without quotes; when it is missing the answer is 428
  `no-revision`; when it is not 64 hex characters, 400.
- **The order of its refusals:** 401; 429; 428 or 400 for `If-Match`; then, inside
  `space.save`: 404 or 410; 415; 413; 409; the checks of the new bytes (422); `empty` and
  `missing-image` (3.3), which `space.save` applies only when it is given a writer; then
  step 4.
- The 409 carries `current` (`text`, `revision`, `entry`) so the agent can merge and send
  again, when the current file is valid UTF-8; when it is not, the 409 has no `current`, as
  now, and its hint says a person must mend the file.
- The answer is `{ revision, entry, url }`.

**`POST /items/:id/append`**, notes only (a drawing is 415). One function, `space.append`,
does all of it inside one `space.run`, so nothing can come between its read and its write.
The route's body limit is a note's limit and 64 KB.

- The body is `text/markdown`. An empty body, or one of only white space, is 422 `empty`.
- The line ending is the note's first one, or LF when it has none; the body's line endings
  are changed to it. A byte order mark at the start of the body is dropped.
- The note is taken in two parts: its **head** (a byte order mark and the front matter
  through the line ending of its closing `---`, which is `parseNote`'s front-matter range; or
  only the byte order mark, or nothing) and its **text** (the rest). Neither the head nor
  the middle of the text is changed.
- Spaces, tabs and line endings are removed from the end of the text (no other character:
  not a kept space, U+00A0), and line endings from the start and the end of the body.
- The result is: the head; then, if the text is not empty, the text and two line endings;
  then the body and one line ending. If the head does not end with a line ending and is not
  empty, one is added after it. So there is exactly one empty line between what was there
  and what was added, and a note that is only front matter keeps its front matter.
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
| 422 | `bad-tag`, `bad-title`, `empty`, `missing-image` | 5.5, 3.3 |
| 428 | `no-revision` | A save without `If-Match` |
| 429 | `busy` | Over a limit of 3.3 |
| 500, 503 | `server`, `unavailable` | A save may or may not have been made: read the item before sending again |

The most common mistake, `curl -d` with no `Content-Type`, is the 415, and its hint names the
three types.

## 6. Later: a short form for drawings

**Nothing in this section is built in this version** (1.1, 3). It is a design kept ready, and
no other section depends on it. It is built only if drawings that agents write by hand come
out badly; "is" below means "would be".

An agent writing Excalidraw by hand may get the many values of each element subtly wrong. The
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
  `agentBytesPerDay` (300 MB), `agentHistory` (10), `agentDrawingHistory` (5);
  `PATTERNS.agentToken` and `agentName`; `Agent`; `agent` in `Entry` and
  `HistoryEntry`; the routes of 2.2 and of section 5, the three that take a document with
  the body limits of 5.5 and 5.6 (without one a route has Fastify's 64 KB); `ErrorBody`
  allows `error.hint`.
- `errors.ts`: `HttpError` takes a hint and puts it in `error`; `CODES` gains 428.
- `layout.ts`: `DataLayout.agentsFile` (`config/agents.json`), and 4.2.
- A new `agents.ts` beside `accounts.ts`: the table, making, revoking, lookup by hash with
  the user check, the hourly `used`, `removeForUserLocked` (2.1); the counts of 3.3.
- `app.ts`: 3.1 and 3.2 in `onRequest`, `preHandler` and the not-found handler, and
  `"none"` where it passes `auth: false` today; the handlers of section 5.
- `space.ts`: `save` takes a writer (`string | null`; the browser's routes pass `null`), with
  4.3 and, for a writer, the refusals of 3.3; `agentCreate` (5.5) and `append` (5.6), new;
  `agent` in the index's facts, `entryOf` and `history`; `history` and `version` over both
  folders. `create` and `saveAsNew` are a person's and do not change.
- `core`: `newNoteText` and `yamlQuote` move here from `space.ts`, with a second function for
  the front matter of 5.5 (`fmwriter` cannot write `created`, so it is not used); a function
  that adds `nook` to a drawing's JSON as 5.5 says; the split of a note for append (5.6).

## 8. The web app

- Account screen: the Agents section of 2.2, and the line about passwords of 2.1.
- Sidebar, editor header, drawing header, the two history screens: 4.1.
- The API client gains the three routes of 2.2. Nothing else in the stores changes: an
  agent's save reaches an open note as another tab's would, as a 409 on the person's next
  save, with **Keep mine** and **Take theirs**.
- Test ids: `agents`, `agent-row`, `agent-name`, `agent-make`, `agent-token`, `agent-copy`,
  `agent-revoke`; `written-by` on the two headers; `note-row` and `history-row` gain
  `data-agent` (the name, or absent).

## 9. Tests the builders write

| Level | What |
|---|---|
| `core` | Front matter before a body: with and without a title and tags; quoting. `nook` added to a drawing, the other keys kept. |
| `server`, tokens | Make, list, revoke; the name's rules and the limit of 20; a revoked token is 401 at once; one person cannot see or revoke another's; removing a user, changing a password and `reset-password` remove the tokens; a token of a removed user is 401; the token is in no log line and only its hash is on disk. |
| `server`, the boundary | 3.4. |
| `server`, the interface | List; both reads, with the `ETag`; history; create of each kind, with and without `title` and `tags`, with and without front matter or `nook`; each row of 5.8 with its hint; save, 409 with `current`, 428, a quoted `If-Match`; append with and without `If-Match`, for LF and CRLF notes, an empty note, a note ending in empty lines, a note with broken front matter; 410; each limit of 3.3. Every `curl` example of the guide. |
| `server`, writers | `agent` in entries and history after each mix of person and agent saves. **A note a person saved 51 times, so that `history/` is full, then saved 51 times by an agent, still has every one of those 50 version files in `history/`, each with the bytes it had, and the text the agent first replaced as a 51st.** The same for a drawing. A person's save after an agent's removes the oldest of the person's beyond 50. A hand edit after an agent's save is a person's. A missing and a broken `writers.json`. A crash after each step of 4.3 is never an agent's text where a person's is. Trash and restore keep both folders. |
| `web` stores | The Agents section through the API client with a fake server. |
| `e2e` | Make a token on the Account screen and copy it; with it, from outside the browser, create a note and the guide's example drawing; both appear in the sidebar with the agent's mark and open; the drawing shows its shapes and labels, opens not unsaved, and is unchanged after a save and a reload. Append to a note open in the browser, then save in the browser and get the conflict. Revoke, and the next request is 401. |

Existing tests that compare a whole entry gain `agent: null`; those that read `auth` from a
route read the new values. No other existing test changes.

## 10. Build order

1. `contract`: `auth`, the limits, the patterns, the types, the routes.
2. `server`: tokens; the boundary of section 3 and its tests, before any agent route exists.
3. `server`: writers in `space.ts` (4.2, 4.3) for a person's saves, with every existing test
   passing once it has `agent: null` where it compares a whole entry (9).
4. `core`: front matter and `nook`. `server`: the routes of section 5, the limits of 3.3, the
   guide.
5. `web`: the Agents section; the marks of 4.1.
6. `e2e`, then `README.md`, `SPEC-NOTES.md`, `PROGRESS.md`, and the changes to `SPEC2.md`.

## 11. Risks

- **A token is a secret in a file on a machine.** Whoever reads it can read every note of
  that person and write to them, until it is revoked. It cannot delete or take the account.
- **An agent can still spoil the current text** with a bad save that is not empty. The
  person's versions are in history, the agent can read history to undo, and the mark of 4.1
  shows that an agent wrote it; nothing stops the save itself.
- **A repeated create makes two items,** and a repeated append adds twice, when the first
  answer was lost. The guide says how to avoid the second.
- **A file put back by hand to an agent's exact bytes** counts as the agent's (4.2), and a
  later agent save files it in `agent-history/`.
- **History can pass 50** while agents save over hand edits and no person saves (4.3).
- **A person editing while an agent saves** gets a conflict on their next save, as with two
  tabs. There is no merge.
- **Disk.** The limits of 3.3 are per day and in memory: over many days, or across restarts,
  agents can still fill a disk, and only a person can remove what they made.
- **A large drawing does not fit in an agent's context.** Reading gives the whole file,
  images included, and saving needs all of it back.
- **A drawing an agent writes by hand may open oddly or not at all.** The check on a save is
  DRAWINGS 4.4's (valid JSON with `type` and `elements`) and 3.3's. The guide's example is
  tested to open; if agents' drawings come out badly, section 6 is the remedy.

## 12. Changes this makes to SPEC2 and SPEC-DRAWINGS

SPEC2 4.2 (two more things in an item's folder). 4.4 (the steps, and what a request may
remove). 4.6 (two folders; a version has a writer). 5 (tokens; three ways to be let in; where
the `Origin` check applies; what a password change ends). 6 (the routes, `auth`, `agent` in
entries, `hint`, 428). 9 (the Account screen; the marks). 11 (the ids of section 8).
SPEC-DRAWINGS 4.4 (agents' versions: 5).

## 13. Open questions for the owner

1. Decisions 4 to 12 of 1.2 are proposals. The two that change something a person does today
   are 11 (a password change revokes tokens) and 12 (the limits of 3.3).
2. Should an agent be able to read a note's photos? Two reviewers asked for it, so that an
   agent can understand a note with pictures. Adding photos stays out either way.

## 14. Changes since draft 1

**Draft 4.** From a check of draft 3 against the code by seven AI models (two did not
answer). Three of them traced 4.3 through every save, crash and hand edit and found the
design sound; all seven found places a builder would have had to guess.

- **Append** kept no line break after a note that is only front matter, which would have
  joined the added text to the closing `---` and lost the title and tags. It now takes the
  note as a head and a text (5.6). Four found this.
- **`writers.json`** records a revision only after its bytes are the main file (4.3, step
  7a), so no crash followed by a hand edit can make a person's text count as an agent's. Its
  valid shape is defined; step 5a keeps the names already in it; a failed write has a rule.
- **`"none"`** covers the pages, the bundle and the favicon, which draft 3 would have put
  behind a session (3.1). Five found this.
- **Unknown agent addresses** skip the body-type check as well as the `Origin` check, and
  the prefix is exactly `/api/agent/` (3.2).
- **`empty` and `missing-image`** compare with the document being replaced, count only
  elements not marked deleted, and apply to a save and an append, not to a create (3.3).
- **Tokens are removed before `users.json` is written,** by a function that assumes the
  accounts lock (2.1). An agent's name has its own pattern.
- **Create** has its own function; the front matter's lines, line endings and byte order mark
  are given; the revision recorded is of the bytes written (4.3, 5.5).
- The order of a save's refusals, the body limits of the three document routes, `url` as a
  full address, `an agent` for an unnamed version, and what a 500 means are stated. The
  count of versions on disk is no longer given as a fixed number, because it is not one.

**Draft 3.** The owner took the short form for drawings back out of this version (1.1, 3)
after the converter check showed its cost. Section 6 keeps the design; the body type, the
`bad-sketch` code, `sketch.ts`, the change to the drawing screen and their tests and build
step are gone from the other sections.

**Draft 2.** From a review of draft 1 against the code by eight AI models (a ninth did not
answer), a check of Excalidraw's converter in Node, and one decision by the owner, since
reversed (draft 3).

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
- The short form for drawings was put in (section 6), with Nook's own converter.
- Not taken: `Idempotency-Key`, paging, a public-address setting (5 says why the request's
  own address is used), reading a drawing without its images, photos.
