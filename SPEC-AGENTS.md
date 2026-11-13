# Nook agents: specification

Draft 1, 2026-11-12. Not built. Not yet reviewed.

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

### 1.2 Proposed in this draft, for the owner to confirm

Nine AI models were asked what interface an agent would want. Where they agreed, this draft
follows them; the splits are marked.

3. **Plain HTTP only.** No command-line tool and no MCP server in this version. Either can be
   added later as a wrapper that holds no rules of its own. (Seven of nine put HTTP first; two
   put a command-line tool first; none put MCP first.)
4. **An agent has its own token,** made by a person in the web app, named, revocable, and tied
   to that person's space. It is not a password and not a session.
5. **Agent routes are a separate set** under `/api/agent/v1`. A token works there and nowhere
   else. A session cookie works everywhere else and not there. The set has no route that
   deletes, trashes, restores, empties, or touches history, photos, fonts, styles or accounts.
   "No delete" is this absence, enforced by the server (section 3).
6. **An agent's saves never push a version a person wrote out of history** (4.3). Without
   this, an agent that saves 51 times has deleted everything the person had, whatever the
   routes say. (Four of nine named this as the most likely mistake.)
7. **Saving is whole-document, as now, plus append for notes** (5.5). No patching. (Eight of
   nine wanted append or would accept it.)
8. **Who wrote what is recorded by the server, outside the file** (4.2). The note format and
   the drawing file do not change. (Five of nine; four would put it in the file.)
9. **Drawings are sent as ordinary Excalidraw files in this version.** A simpler form that the
   server turns into a scene is section 9, not built now. (Eight of nine wanted the simpler
   form; this draft defers it because its cost is not yet known. The owner may move it in.)

### 1.3 Not in this version

A command-line tool. An MCP server. The simpler drawing form (section 9). Photos added by an
agent. Reading history or the trash. Patching. Keys that make a repeated create harmless
(`Idempotency-Key`). Refusing a save because it removes most of a document. Telling the open
web app that an agent changed something (the person sees it on the next list or save).

## 2. Tokens

### 2.1 What a token is

- A token is `nook_` followed by 40 characters of lower-case base-32 (200 random bits), made
  with the server's random source.
- The server keeps only its SHA-256, in `config/agents.json`, written under the accounts lock
  by SPEC2's rule for `users.json` and kept in memory. A record is
  `{ id, userId, name, hash, created, used }`: `id` is 16 base-32 characters; `used` is the
  time of the last request, written at most once an hour.
- **The name** is 1 to 40 characters with no control characters (the pattern of a style's
  name), trimmed, and unique among one person's tokens, compared without case.
- A person may have at most 20 tokens (`LIMITS.agents`).
- Removing a user removes that user's tokens. Changing a password does not.
- `config/` is already in the backup, so the hashes are.

### 2.2 Making and revoking, in the web app

Three routes for the browser, with a session and the `Origin` check as every other:

| Route | Body | Answer |
|---|---|---|
| `GET /api/agents` | none | `{ agents: [{ id, name, created, used }] }` |
| `POST /api/agents` | `{ name }` | 201 `{ agent, token }`; 409 for a name in use; 422 at the limit of 20 |
| `DELETE /api/agents/:id` | none | `{}`; 404 for another person's or none |

The token is in the answer to `POST` once and is never shown again.

The Account screen gains a section, **Agents**: the list (name, when made, when last used),
a field and a button to make one, and **Revoke** on each row, which asks first. After making
one, the screen shows the token with a **Copy** button, the address of the guide (5.1) and a
line saying it will not be shown again; it stays until the person closes it.

## 3. The agent routes and "no delete"

- **A separate set.** Every agent route's address begins `/api/agent/v1/`. They are listed in
  `contract` with `agent: true`; every other route has `agent: false`.
- **Authentication.** An agent route reads `Authorization: Bearer <token>`. A missing or
  malformed header, or a token whose hash is not in the table, is 401 with the code
  `no-token` and a hint naming the guide's address. Cookies are not looked at. The user is the
  token's.
- **The `Origin` check does not apply to an agent route** (a program sends none, and no
  browser sends the token by itself). It applies to every other route as now.
- **A token is not a session.** The `preHandler` of every other route looks only at the
  cookie, so a request with a token and no cookie is 401 there, as now.
- **A session is not a token.** An agent route does not accept a cookie.
- **No route in the set deletes.** The set is exactly section 5. It has no `DELETE` method.
- **Tests hold this** (section 8): for every route of `contract` that is not an agent route,
  a request with a good token and no cookie is 401 and changes nothing on disk; no agent
  route has the method `DELETE`; `DELETE` on every agent address is 404 or 405.
- **A limit on changes.** One token may make at most 60 changing requests in any minute
  (`LIMITS.agentChanges`), counted in memory; beyond that, 429 with a hint saying when to try
  again. Reading is not limited.
- The body-type check of `onRequest`, the 64 KB limit on JSON, the response headers and the
  log line apply to agent routes as to others. The log never holds a token.

## 4. Who wrote what

### 4.1 What a person sees

- `Entry` gains `agent: string | null`: the name of the agent whose request wrote the file as
  it is now, or `null` when a person's did. `HistoryEntry` gains the same for the text that
  version holds.
- The name is copied when the write is made. Revoking or renaming nothing changes it.
- **Sidebar:** a row whose `agent` is not null shows a small mark beside the time, with the
  name as its title.
- **Editor and drawing screens:** the header says "Written by *name*" beside the save status
  until a person saves.
- **History screens:** a version an agent wrote says so, with the name.
- When a person saves, `agent` becomes `null`. When a person restores a version, the result
  is the person's.

### 4.2 Where it is kept

A file `writers.json` in the item's folder, beside the main file:

```json
{ "current": "claude on the laptop", "versions": { "2026-11-12T20-15-04.120Z-ab2c": "claude on the laptop" } }
```

- `current` is the agent that wrote the main file, or `null`. `versions` names the agent for
  each history version an agent wrote; a version not named was a person's.
- A folder without the file is all a person's. The file is made by the first agent write.
- It moves with the folder to the trash and back, and into the backup, with no new step.
- `layout.ts`: `NotePart` gains `"writers.json"`.
- A file that is not valid JSON of this shape is read as absent and replaced by the next save.

### 4.3 Saving, with a writer

SPEC2 4.4's steps, with these changes. They apply to every save, by a person or an agent,
because a person's save must also move `current` into `versions`.

- **Step 5** (the old bytes go to history as version *v*): unchanged.
- **Step 6** (replace the main file): unchanged.
- **Step 6a, new:** `writers.json` is replaced, by rule 3: `versions[v]` is the old `current`
  if it was not null; `current` is the name of the agent saving, or `null` for a person.
- **Step 7** (old history goes) becomes: the versions are split into those in `versions` (an
  agent's) and the rest (a person's). **Each group keeps its newest 50** (20 for a drawing),
  and the oldest beyond that go. The names of removed versions leave `writers.json`.

So an agent's saves can remove only agents' versions, and a person's history is what it would
have been had the agent never run, except for one thing: the first agent save after a
person's puts the person's text into history as a person's version, exactly as the person's
own next save would have.

A crash between steps 6 and 6a leaves the main file new and `writers.json` old: one version
is named for the wrong writer. Nothing is lost, and this is accepted. A create writes
`writers.json` before the folder is moved into place, so a created item is never wrong.

On disk an item can now hold twice the history it could: for a drawing, 40 versions of up to
25 MB.

## 5. The interface

All addresses below are under `/api/agent/v1`. Answers are JSON unless said. "Item" means a
note or a drawing.

### 5.1 The guide: `GET /api/agent/v1`

No token needed. It answers `text/markdown`: a page an agent can read once and work from,
written for this server (its own address in every example). It holds:

- what an item is, the two kinds and their body types, the limits (2 MB, 25 MB), the tag
  pattern, the id pattern;
- each route of this section with one `curl` example and its answer;
- how to change a note: read, edit the text, save with the revision; what to do on 409;
- a complete small note, and a complete small drawing (a rectangle, a text and an arrow bound
  to both) that opens in Nook;
- every error code of 5.7 with what to do about it;
- what a token cannot do, said plainly, so an agent does not go looking: delete, trash,
  restore, history, photos.

The page's text is one file in the repository, `packages/server/src/agent-guide.md`, with the
address filled in when it is served. A test runs every `curl` example in it against a real
server.

### 5.2 List and search: `GET /items?tag=&q=`

As `GET /api/notes`: `{ entries, tags }`, both kinds, newest first, with `agent` in each entry.

### 5.3 Read: `GET /items/:id`

As `GET /api/notes/:id`: `{ text, revision, entry }`. `text` is the whole file: for a note the
Markdown with its front matter; for a drawing the Excalidraw JSON.

### 5.4 Create: `POST /items?title=&tags=`

- The body is the document, with the type of its kind: `text/markdown` for a note,
  `application/vnd.excalidraw+json` for a drawing. An empty body with `text/markdown` makes
  an empty note. There is no JSON form and no `from`.
- `title` is up to 300 characters. `tags` is a list separated by commas; each must match the
  tag pattern, or the request is 422 naming the tag (an agent's tags are not cleaned for it).
- **A note whose body does not begin with front matter:** the server writes the front matter
  (`title`, or `Untitled N` by SPEC2 4.3; `tags` if given; `created`, today) before the body.
- **A drawing without a `nook` key:** the server adds it likewise, and writes the file in the
  form of DRAWINGS 4.2.
- **A body that has its own front matter or `nook` key** is stored as sent, and `title` or
  `tags` in the address is then 400 with a hint to put them in the document.
- The body is checked as a save of that kind is. The answer is 201
  `{ id, revision, entry, text, url }`, where `url` is the item's address in the web app for
  the agent to give its person.

### 5.5 Save and append

**`PUT /items/:id`** is SPEC2 4.4 as changed by 4.3: the whole document, `If-Match` with the
revision, the type of the item's kind. Its refusals are those of `PUT /api/notes/:id`; the
409 carries `current` (`text`, `revision`, `entry`) so the agent can merge and send again.
Without `If-Match` the answer is 428 with a hint (not 400).

**`POST /items/:id/append`**, notes only (a drawing is 415):

- The body is `text/markdown`, not empty, and is added at the end of the note: if the note
  does not end with a line break one is added, then one empty line, then the body, then a
  line break if the body has none. The note's own line endings are used.
- `If-Match` is optional. Without it the append is made to whatever the note holds now; the
  user's lock (SPEC2's rule 2) makes that safe. With it, a stale revision is 409.
- It is a save in every other way: the size limit, the history step, the writer, the answer
  `{ revision, entry }`.

### 5.6 What is not here

Any other method or address under `/api/agent/` is 404 with the code `not-found` and a hint
naming the guide. In particular there is no way to trash, to read or restore history, to add a
photo, or to see another person's items.

An item in the trash is 410 on read, save and append, with a hint that a person moved it to
the trash and only a person can bring it back.

### 5.7 Errors

An error on an agent route is the existing body with one more value:

```json
{ "error": { "code": "changed", "message": "The note was changed since you opened it.", "hint": "Read the item again, apply your change to the new text, and save with the new revision." } }
```

`hint` says what to do next, in one or two sentences, and names the exact value at fault where
there is one (the tag, the header, the size and the limit). Every refusal of an agent route
has one. The codes:

| Status | Code | When |
|---|---|---|
| 400 | `bad-request` | The address or its values are wrong |
| 401 | `no-token` | No token, or one that is not known |
| 404 | `not-found` | No such item, or no such route |
| 409 | `changed` | The revision is stale |
| 410 | `trashed` | The item is in the trash |
| 413 | `too-large` | Over the kind's limit; says the size and the limit |
| 415 | `unsupported-type` | The body type is not the item's kind, or append on a drawing |
| 422 | `refused`, `bad-tag`, `not-utf8`, `not-json`, `not-excalidraw` | The document or a value is not acceptable |
| 428 | `no-revision` | A save without `If-Match` |
| 429 | `busy` | Over the limit on changes |

## 6. Contract and server

- `contract`: `LIMITS.agents` (20), `LIMITS.agentChanges` (60), `PATTERNS.agentToken`,
  `Agent` (`id`, `name`, `created`, `used`), `agent` in `Entry`, `TrashEntry` and
  `HistoryEntry`, the routes of 2.2 and of section 5, and `agent: boolean` on every route.
  `ErrorBody` allows `hint`.
- `accounts.ts` (or a new `agents.ts` beside it): the table, making, revoking, looking a
  token up by its hash in constant time, the hourly `used`, removal with the user.
- `app.ts`: `onRequest` skips the `Origin` check for a route with `agent: true`;
  `preHandler` authenticates such a route by token and every other by cookie, never both;
  the handlers of section 5 call the same `space` functions the browser's routes do, with the
  writer's name; the error handler adds the hint on agent routes.
- `space.ts`: `save`, `create` and `saveAsNew` take a writer (`string | null`); the new step
  6a and the new step 7; `append`; `agent` in the index's facts, in `entryOf`, in `history`
  and in the trash entry. `layout.ts` as in 4.2.
- `core`: a function that puts front matter before a note's body from a title and tags (using
  `fmwriter`), and one that adds `nook` to a drawing, both pure and tested.

## 7. The web app

- Account screen: the Agents section of 2.2.
- Sidebar, editor header, drawing header, the two history screens: 4.1.
- The API client gains the three routes of 2.2. Nothing else in the stores changes: an
  agent's save reaches an open note as another tab's would, as a 409 on the person's next
  save, with **Keep mine** and **Take theirs**.
- Test ids: `agents`, `agent-row`, `agent-name`, `agent-make`, `agent-token`, `agent-copy`,
  `agent-revoke`; `written-by` on the two headers; `note-row` and `history-row` gain
  `data-agent` (the name, or absent).

## 8. Tests the builders write

| Level | What |
|---|---|
| `core` | Front matter put before a body: with and without a title and tags, a body that already has front matter. `nook` added to a drawing. |
| `server`, tokens | Make, list, revoke; the name's rules and the limit of 20; a revoked token is 401 at once; one person cannot see or revoke another's; removing a user removes the tokens; the token is in no log line and only its hash is on disk. |
| `server`, the boundary | For every non-agent route of `contract`: a good token without a cookie is 401 and nothing on disk changes. For every agent route: a good cookie without a token is 401. No agent route has `DELETE`; `DELETE` on each agent address is 404 or 405. A token reaches only its own person's items. An agent route works with no `Origin` and with a foreign one. |
| `server`, the interface | List, read, create of each kind with and without `title` and `tags`, each refusal of 5.7 with its hint, save, 409 with `current`, 428, append with and without `If-Match`, append's line breaks for LF and CRLF notes, 410 for a trashed item, 429 at the limit. Every `curl` example of the guide. |
| `server`, writers | `agent` in entries and history after each mix of person and agent saves. **51 agent saves of a note a person saved 50 times leave all 50 of the person's versions.** The same for a drawing with 20. A person's save after an agent's. A crash after each step of 4.3. A broken `writers.json`. Trash and restore keep it. |
| `web` stores | The Agents section through the API client with a fake server. |
| `e2e` | Make a token on the Account screen and copy it; with it, from outside the browser, create a note and a drawing; both appear in the sidebar with the agent's mark and open; the drawing shows its shapes. Append to a note open in the browser, then save in the browser and get the conflict. Revoke, and the next request is 401. |

Existing tests that compare a whole entry gain `agent: null`. No other existing test changes.

## 9. Later: a simpler form for drawings

Not built in this version. Recorded because eight of the nine models asked for it: an agent
writing Excalidraw by hand gets the many values of each element subtly wrong (ids, seeds,
bound text, arrow bindings).

The idea: a second body type for create, a short list such as

```json
{ "shapes": [ { "id": "a", "type": "rectangle", "x": 0, "y": 0, "width": 160, "height": 60, "label": "Browser" },
              { "id": "b", "type": "rectangle", "x": 320, "y": 0, "width": 160, "height": 60, "label": "Server" } ],
  "arrows": [ { "from": "a", "to": "b", "label": "PUT" } ] }
```

which the server turns into an ordinary `drawing.excalidraw`. Reading always gives the
Excalidraw file; the short form is for creating only.

What is not known, and would be the first step: Excalidraw's own converter for such a list
(`convertToExcalidrawElements`) is part of its browser package. Whether it runs in Node
without a page, and whether text it has not measured is laid out correctly when the drawing
is opened, has not been checked. If it does not run, Nook needs its own converter in `core`.

## 10. Build order

1. `contract`: the limits, the patterns, `agent` on routes and entries, the new routes.
2. `core`: the two functions of section 6, with tests.
3. `server`: tokens; the boundary in `app.ts` and its tests, before any agent route exists.
4. `server`: writers in `space.ts` (4.2, 4.3) for a person's saves, with every existing test
   still passing; then the agent routes of section 5, append, and the guide.
5. `web`: the Agents section; the marks of 4.1.
6. `e2e`, then `README.md`, `SPEC-NOTES.md`, `PROGRESS.md`, and the changes to `SPEC2.md`.

## 11. Risks

- **A token is a secret in a file on a machine.** Whoever reads it can read every note of
  that person and write to them, until it is revoked. It cannot delete or take the account.
- **An agent can still spoil the current text** of a note or a drawing with a bad save. The
  person's versions are in history (4.3) and the mark of 4.1 shows that an agent wrote it;
  nothing stops the save itself.
- **A repeated create makes two items** when the first answer was lost. Accepted for now.
- **A person editing while an agent saves** gets a conflict on their next save, as with two
  tabs. There is no merge.
- **Twice the history on disk** (4.3).
- **Hand-written Excalidraw** may open oddly or not at all until section 9 exists. The check
  on a save is only DRAWINGS 4.4's: valid JSON with `type` and `elements`.
- **`writers.json` can be one write behind** after a crash (4.3).

## 12. Changes this makes to SPEC2 and SPEC-DRAWINGS

SPEC2 4.2 (a file in an item's folder). 4.4 (a step, and the rule for old history). 4.6 (a
version has a writer). 5 (tokens; where the `Origin` check applies). 6 (the routes, `agent` in
entries, `hint`, 428). 9 (the Account screen; the marks). 11 (the ids of section 7).
SPEC-DRAWINGS 4.4 (history: 20 of a person's and 20 of agents').

## 13. Open questions for the owner

1. Should the simpler drawing form (section 9) be in this version after all?
2. Should a command-line tool or an MCP server be in this version?
3. Is twice the history on disk acceptable, or should agents' versions have a smaller limit?
4. Should an agent be able to add photos to a note?
