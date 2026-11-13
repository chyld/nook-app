# Nook drawings: specification

Draft 5, 2026-11-12. Not built. Section 12 says what changed since the earlier drafts.

This document adds drawings to the app that `SPEC2.md` describes. Where it is silent,
`SPEC2.md` applies to a drawing as it does to a note. "SPEC2 4.4" means that document's
section 4.4. Section 11 lists the parts of `SPEC2.md` this document changes.

A person can create a new note or a new drawing. A drawing is edited with Excalidraw, the
open-source whiteboard, running inside Nook.

## 1. Decisions

### 1.1 Made by the owner on 2026-11-12

1. **A drawing is its own kind of item.** It is not a note, and it has no `note.md`.
2. **Excalidraw runs inside the app** as its React component. The `excalidraw/excalidraw`
   Docker image is not used: it is only the static excalidraw.com app, with no storage API.
3. **New dependencies are agreed** (SPEC2 3): `react`, `react-dom` and `@excalidraw/excalidraw`
   (0.18.1 when this was written), each written in `package.json` as an exact version. Nothing
   else is added.
4. **A drawing's images are inside its file,** as Excalidraw itself stores them. The photo
   pipeline is not used for drawings.
5. **Security is not a constraint.** The owner is the only person who uses the app, for notes
   kept a short time. Where a protection of SPEC2 stands in the way of a feature of this
   document, the protection gives way. The app has one content security policy, a loose one
   (3.2), and Excalidraw's own features stay on unless Nook cannot support them (3.3).
6. **A drawing has a title and tags, and is searched** by title, tags and the text in it.
7. **Drafts of drawings** are stored where note drafts are, with no size rule of their own. A
   draft does not hold image data (4.5).
8. **A drawing file that Nook did not write** (for example from excalidraw.com, put in the
   folder by hand) opens as it is, images included, with the title `Untitled` and no tags.
9. **The shape library is kept in the browser** (3.3).

### 1.2 Not in this version

Drawings inside notes. Live collaboration, Excalidraw's AI features and its links to
Excalidraw+ (each needs a service Nook does not have). Autosave (SPEC2 1.1). Merging two
people's changes. Thumbnails. Viewing a drawing in the trash before restoring it.

## 2. First step: see it work

The first thing built is a page that mounts the pinned Excalidraw in the production build,
served by the real server with the policy of 3.2. The builder checks that it draws, types
text, shows an image, loads its fonts from Nook, opens a shape library and embeds a web page,
and records in `SPEC-NOTES.md`:

- anything the policy of 3.2 still blocked, and the directive added for it;
- the real names, in the pinned version, of the options, controls, `appState` keys and
  library functions this document names;
- whether opening a scene, with no action by the person, changes any element's version, and
  if so which elements (4.3);
- whether Vite needs a `define` for the package to build.

Nothing found here stops the work: what Excalidraw needs, the policy allows; where a name
differs, the real one is used.

## 3. Loading Excalidraw

### 3.1 The script, the styles and the fonts

- A new screen, `packages/web/src/screens/DrawingScreen.svelte`, first sets
  `window.EXCALIDRAW_ASSET_PATH = "/assets/excalidraw/"`, and only then calls
  `import("../drawing/mount.ts")`. That module imports `react`, `react-dom/client`,
  `@excalidraw/excalidraw` and its CSS, and mounts the component with `createRoot` and
  `createElement` (no JSX, so no React plugin). The screen unmounts the root when it is left.
  The path cannot be set inside `mount.ts`, whose imports run before its own code.
- **A note does not download it.** Excalidraw's script and CSS are in files requested only
  when a drawing is first opened. `cssCodeSplit: false` in `vite.config.ts` is changed, or the
  CSS is loaded as its own file. An `e2e` case checks that opening a note requests no
  Excalidraw file.
- **Its CSS is not put in a CSS layer,** so the app's layered rules for `button`, `input` and
  the like cannot override it. If one of its rules is seen to restyle the app outside
  `.excalidraw`, that rule is overridden in the app's own CSS.
- **Fonts come from Nook.** A build step copies the package's `fonts` folder to
  `dist/assets/excalidraw/fonts/`, so a font is at `/assets/excalidraw/fonts/<Family>/<file>`.
  The asset route of `app.ts` serves them; `ASSET_TYPES` gains any type they need. An `e2e`
  case checks that no font is requested from another address.
- Excalidraw's CSS is exempt from the token and raw-colour rules, as `paper.css` is.
- While the script loads the screen says so. If it fails, the screen says so and offers to try
  again.

### 3.2 The policy

`CSP` in `app.ts` sends one policy with every page. It replaces SPEC2 5's:

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:;
style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:;
font-src 'self' data: https:; connect-src 'self' data: blob: https:;
worker-src 'self' blob:; frame-src https:; media-src 'self' data: blob: https:;
base-uri 'none'; form-action 'self'; frame-ancestors 'none'
```

The style nonce leaves the policy (a nonce would switch `'unsafe-inline'` off). The
`csp-nonce` meta tag stays, so code that reads it is untouched. Every existing screen must
work as before under this policy. Going between a note and a drawing is ordinary navigation
on the client.

Accounts, sessions, the `Origin` check and the separation of users are not touched.

### 3.3 Excalidraw's features

Excalidraw's features are left on: images of every type it accepts (SVG included), shape
libraries, embedded web pages, Mermaid, saving a picture or a scene file to the person's own
disk, and loading a scene from a file.

- **The shape library** is kept in the browser's local storage under the user's id. The mount
  reads it into `initialData.libraryItems`, writes it on `onLibraryChange`, sets
  `libraryReturnUrl` to the drawing's address, and takes in a library that
  libraries.excalidraw.com sends back in the address (`#addLibrary=…`), with Excalidraw's
  `useHandleLibrary`. If the browser refuses the write, a message says the library was not
  kept.
- **Hidden** where they appear, through options or CSS: collaboration, the AI features and the
  links to Excalidraw+.
- **Ctrl+S** is caught by a key listener on the window in the capture phase, which stops the
  event and saves to Nook.
- **Loading a scene** from a file, by the menu or by dropping the file, replaces the scene as
  Excalidraw does and makes the drawing unsaved. The title and tags are kept.

## 4. Storage

### 4.1 Layout

A drawing lives in the same tree and the same id space as a note:

```
users/<user-id>/notes/<id>/
  drawing.excalidraw
  history/<version>.excalidraw
```

- **The main file decides the kind.** A folder with a regular file `note.md` is a note. A
  folder without one and with a regular file `drawing.excalidraw` is a drawing. Any other
  folder is ignored, as now.
- Trash, restore, emptying, `removed/` and the backup move or copy whole folders; their steps
  (SPEC2 4.3, 13) do not change.

### 4.2 The file

`drawing.excalidraw` is an ordinary Excalidraw file, UTF-8 JSON, which may have one more
top-level key:

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "nook",
  "elements": [],
  "appState": { "viewBackgroundColor": "#ffffff" },
  "files": {},
  "nook": { "title": "Untitled 1", "tags": [], "created": "2026-11-12" }
}
```

It opens in excalidraw.com as it is, and a file from there is a valid drawing.

**One module, `packages/core/src/drawing.ts`,** pure and tested in Node, used by the server
and the browser:

- `serializeDrawing(scene, nook)` gives the file's text: the top-level keys in the order
  above; every element that is not deleted, in scene order, each with its keys in alphabetical
  order; of `appState` only `viewBackgroundColor`, `gridSize`, `gridStep` and
  `gridModeEnabled`; in `files` only the images a remaining element uses, by id in
  alphabetical order, each as Excalidraw gives it; two-space indent, LF, a final line break.
  The view position, zoom, selection and tool are not saved.
- `drawingFacts(text)` gives what the index needs (4.6), and never throws.
- `emptyDrawing(title, created)` gives the text a create writes.

The server never changes the bytes of a save.

### 4.3 What counts as unsaved

- **Ready.** A drawing is ready when Excalidraw has the scene and its images,
  `document.fonts.ready` has resolved, and one animation frame has passed. `data-ready` is set
  then, and Save is disabled until then.
- **The signature** of a drawing is: for each element that is not deleted, in order, its `id`
  and `version`; the four kept `appState` values; the title; the tags.
- **The baseline** is the signature taken when the drawing becomes ready after its file was
  read from the server: on opening, after **Take theirs**, and after a save succeeds. Opening
  a draft and loading a scene from a file replace the scene and leave the baseline alone, so
  the drawing is then unsaved.
- **A drawing is unsaved when its signature differs from the baseline.** So a drawing never
  opens unsaved, and moving the view changes nothing. Undoing every change still leaves it
  unsaved; this is accepted. If section 2 finds that opening alone changes some element's
  version, the baseline is taken after that change.
- Excalidraw reports a change on every pointer move. The screen tells the store at most once
  per 200 ms, always including the last change. The view's `flush()` does it at once; the
  store calls `flush()` before a save, a draft and the question on leaving, as it does for a
  note.

### 4.4 Saving, history and conflicts

SPEC2 4.4 applies with `drawing.excalidraw` for `note.md`. The body is the full serialization,
images included. Step 3 checks only that the bytes are:

- at most 25 MB (`LIMITS.drawingBytes`; otherwise 413, and the screen says how large the
  drawing is and that nothing was lost);
- valid UTF-8, and a JSON object with `type` `"excalidraw"` and an array `elements`
  (otherwise 422 with the reason).

History (SPEC2 4.6): the old bytes go to `history/<version>.excalidraw`. A drawing keeps its
newest 20 versions (`LIMITS.drawingHistory`), because a version repeats the images. A new
screen at `/d/<id>/history` lists the versions, shows one in Excalidraw in view mode, and
restores it by saving that version's text against the current revision. Every version is a
whole file, so every version can be restored.

### 4.5 Drafts

- A drawing's draft is its serialization with `files` empty, and its kind. It is stored and
  removed by the rules of SPEC2 9.5.
- **Opening a draft:** the screen takes the scene from the draft and the image data from the
  file it read from the server, by file id. An image the file does not have shows as
  Excalidraw's placeholder, and a message says how many images added after the last save are
  not in the draft.
- **Take theirs** keeps the person's scene as a draft in the same form.
- **Save as a new drawing** of a draft whose drawing is gone sends the draft with
  `?from=<id>`. If the source is live or in the trash, the server puts into `files` each image
  the draft's elements use and the source's file has. `photosMissing` is true when an image
  the elements use is in neither.

### 4.6 The index, search, titles and odd files

- `drawingFacts` reads `nook` value by value: `title` if it is a string (cut to 300
  characters), each of `tags` that matches the tag pattern, `created` if it is a date in the
  note format's form. Anything else is passed over. Without a title the title is `Untitled`.
- The text for search and the excerpt is, for each element of type `text` that is not
  deleted, its `originalText` if it is a string, otherwise its `text`, joined by line breaks.
  Never the JSON.
- The index holds a drawing's facts and that text, not its bytes.
- With no title given, a new drawing is `Untitled N` by SPEC2 4.3, counting notes and
  drawings together; `created` is today's date.

| The file | Listed as | Opening it |
|---|---|---|
| Not valid UTF-8 | `problem: "unreadable"` | Refused. Never written. |
| Not JSON, or without `type` `"excalidraw"` and an array `elements` | `problem: "broken"`, title `Untitled` | The screen says the file cannot be read. Never written. |
| Anything else, whoever wrote it | No problem | Opens. A save writes it in the form of 4.2, keeping its images; the old bytes are in history. |

## 5. Contract and server

- `Entry` and `TrashEntry` gain `kind: "note" | "drawing"`, always present.
- The drawing body type is `application/vnd.excalidraw+json`. It joins `CHANGING_TYPES`, gets
  a parser that keeps the raw bytes, and is accepted by the body check of `onRequest` on the
  two routes below. `BodyKind` gains `"document"` (either document type) and
  `"json-or-document"`. A JSON body stays at most 64 KB.
- `PUT /api/notes/:id` has body `"document"` and a route limit of 25 MB. Inside `space.run`:
  a body type that is not the item's kind is 415; then the limit of that kind (2 MB for a
  note, as now) is 413.
- `POST /api/notes` has body `"json-or-document"` and the same route limit. JSON
  `{ title?, kind? }` creates an item (`kind` defaults to `"note"`). A document body is save
  as new, of the kind its type names, checked as a save of that kind is.
- `GET /api/notes/:id` answers `{ text, revision, entry }` for both kinds.
- History, version, trash, restore and empty keep their addresses and work on both kinds. The
  photo and asset routes answer 404 for a drawing.
- `LIMITS.drawingBytes` is 25 MB (Caddy allows 27 MB) and `LIMITS.drawingHistory` is 20.
  `PAGES` gains `/d/:id` and `/d/:id/history`.
- `layout.ts`: `NotePart` gains `"drawing.excalidraw"`, and a version part is
  `{ version, kind }`, where the kind gives the extension.
- `space.ts`, all by kind: the folder check, the facts, `live`, `read`, `create` and its
  `Untitled N`, `saveAsNew`, `save` with its history step and its removal of old versions,
  `history`, `version`, the trash entry and the trash list.

## 6. The interface

- **Router and screens.** `match` gains `/d/<id>` and `/d/<id>/history`. `App.svelte` and
  `Layout.svelte` mount `DrawingScreen` for a drawing as they mount `EditorScreen` for a note.
- **A wrong-kind address.** The kind is known only when the item has been read. Both screens
  make their view only after the store holds the item; if its kind is the other one, the
  store goes to the right address with `replace`, and no view is made.
- **Sidebar:** **New drawing** beside **New note**. One list, newest first; a drawing's row
  has a pen icon and goes to `/d/<id>`. Tag chips and search cover both kinds.
- **Drawing screen:** the editor screen's layout, with the sidebar. The header has the notes
  button, the title, the tags, the save status, Save, History and Move to trash. No mode
  button, no note settings, no toolbar. Changing the title or a tag makes the drawing unsaved
  until Save.
- **The `editor` store gains a kind.** For a drawing it does not use `core`'s `load` and
  `serialize`; it asks the view whether the drawing is unsaved (4.3), for the text to save
  (4.4) and for the text of a draft (4.5); and its messages say "drawing". With that, one
  save at a time, the queued save, **Keep mine** and **Take theirs**, 410 and 404 with "Save
  as a new drawing", drafts and the question on leaving behave as SPEC2 4.4 and 9.5 say.
- **The API client** sends `save` and `saveAsNew` with the type of the item's kind, and
  `create` with a kind. `library.restoreVersion` saves with the item's kind.
- **A draft gains a kind.** A stored draft without one is a note's. The home screen offers
  "Save as a new drawing" for a drawing's draft whose drawing is gone.
- **History of a note** is unchanged. **Trash:** a drawing's row says it is a drawing and can
  be restored or emptied; it has no reader.
- Under 640 pixels the sidebar is a sheet as now, and Excalidraw uses its small-screen layout.

## 7. Test ids and the test hook

Added to SPEC2 11:

- `new-drawing`; `note-row` and `trash-row` gain `data-kind` (`note` or `drawing`).
- `drawing`: the element Excalidraw is mounted in, with `data-ready="true"` when the drawing
  is ready (4.3).
- The drawing screen's header uses the ids `notes-button`, `note-title`, `tag-input`, `tag`,
  `tag-remove`, `save`, `save-status`, `note-history` and `note-trash` on its own controls.
  The drawing history screen uses `history-row` and `history-restore`.

On the drawing screen `window.__drawing` is
`{ text(), addText(text, x, y), setBackground(colour), addImage(file) }`. `text()` is the
serialization of 4.2; the others do what the person's own action would.

## 8. Tests the builders write

| Level | What |
|---|---|
| `core` | `serializeDrawing`: the same scene gives the same bytes; deleted elements and unused images are left out; the view position is not in it. `drawingFacts`: each value of `nook` right, wrong and missing; `originalText` before `text`; text that is not JSON. |
| `server` | Create, read, save, 409, 410, 413 at each kind's limit, 415 for the wrong type, each 422 reason, history and its limit of 20, restore, trash and restore, save as new with images filled in and with `photosMissing`, search by drawing text. Each row of the table in 4.6. Each operation of SPEC2 4.3 stopped after each step for a drawing. Two users cannot reach each other's drawings. Path attacks. |
| `web` stores | A drawing through the `editor` store with a fake view: save with the right type, 409, a queued save, a draft with its kind and without image data, save as new of a gone drawing. A note still saves as Markdown. |
| `e2e` | Under the real policy: create a drawing, add text, save, reload, and it is not unsaved; change only the background and it is unsaved; a change followed at once by leaving asks first; add an image, save, reload and see it; a scene file with an image loaded from disk, saved and reloaded; a file from excalidraw.com placed in the folder opens with its image; a draft opened after a reload; a library item added, and still there after a reload; a conflict in two tabs; trash and restore; history and restore; Ctrl+S saves to Nook; going from a drawing to a note and back keeps both working; opening a note requests no Excalidraw file; no font comes from another address. |

Existing tests that compare a whole entry gain `kind: "note"`, and existing tests of the
policy's text change to the policy of 3.2. No other existing test changes.

## 9. Build order

1. The first step of section 2, and its result written down.
2. `contract`: `kind`, the body kinds and type, the limits, the pages.
3. `core`: `drawing.ts` and its tests.
4. `server`: `layout`, `space`, the body pipeline and the policy in `app.ts`; tests.
5. `web`: the store, client and drafts by kind; the router's two addresses; `mount.ts` and the
   drawing screen; the library; the sidebar; drawing history; trash.
6. `e2e`, then `README.md`, `SPEC-NOTES.md`, `PROGRESS.md`, and the changes to `SPEC2.md`.

## 10. Risks

- **Large files.** A drawing with images can reach megabytes; each save sends the whole file,
  and each of up to 20 history versions repeats it. A drawing over 25 MB cannot be saved until
  something is removed from it.
- **A draft has no image data.** After a crash, images added since the last save are missing
  from the recovered drawing.
- **Excalidraw changes.** It is at 0.18 and its format and options can change. The version is
  pinned; an upgrade is checked by loading and saving stored drawings.
- **Size of the script.** A few megabytes, loaded only when a drawing is opened; the build
  reports it.
- **Whole-drawing conflicts.** There is no merge.
- **The library** lives in one browser and is not in the backup.
- **The policy is loose for the whole app,** notes included. The owner has accepted this.

## 11. Changes this makes to SPEC2

3 (three dependencies). 4.2 and 4.5 (a second main file; what is ignored; what the index holds
for a drawing). 4.4 and 4.6 (limits and history by kind). 5 (the policy of 3.2 replaces it).
6 (the body type; 415 for the wrong kind; `kind` in entries and in create). 9.1 (two
addresses). 9.2 and 9.5 (kind in the store and in drafts). 11 (the ids of section 7). 12 (the
tests of the policy's text).

## 12. Changes since draft 1

**Draft 5.** From a review of draft 4 by 12 AI models, and two decisions by the owner (1.1,
items 4 and 9).

- Images are inside the drawing file (4.2), not separate files. This removes uploads from
  drawings altogether, with the pending, failed and mismatched images the review found, and
  makes every history version restorable. The photo route is unchanged; SVG needs no rule.
- "Unsaved" is decided by a signature of element versions, with a defined moment for the
  baseline and a `flush` (4.3). The review found that comparing texts would have opened
  drawings as unsaved and could miss the last change.
- The shape library is stored by Nook in the browser (3.3); the component does not keep it.
- Excalidraw's CSS is not put below the app's layers (3.1), which would have broken its
  toolbar.
- The serializer and the facts for the index are in `core`, shared by server and browser.
- Search uses `originalText`. `nook` is read value by value. A wrong-kind address is settled
  before a view is made. The tests that change are named.
- A drawing may be 25 MB and keeps 20 versions.

**Draft 4.** The owner said the app has one user and security is not a constraint. The policy
is the loose one of 3.2; Excalidraw's libraries, embedded pages, Mermaid and loading a scene
from a file are on.

**Draft 3.** The separate drawing policy and the full page loads were removed.

**Draft 2.** From a review of draft 1 by 11 AI models: the body type carried through the
whole request path; a kind in the store, the client and drafts; the functions and screens
tied to `note.md` listed, with a drawing history screen.
