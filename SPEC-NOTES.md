# Notes on SPEC2.md

Where the spec was silent, could not be built as written, or disagreed with version 1's
routines and tests (rule 4 of the brief: the code wins). Each line names the place.

## Dependencies

- `@types/node` is added as a development dependency: `tsc` cannot check the server or the
  Node tests without Node's type declarations. It ships no code.
- `typescript` is 6.0 rather than 7.0 (which version 1 uses): `svelte-check` 4.7 needs
  TypeScript 5 or 6.

## Section 7 (core)

- 7.1: `nextSize` and `SIZE_LIST` are replaced by `stepSize(size, dir)` in
  `core/src/style/apply.ts`: one point up or down, rounded to one decimal, kept within 1 to 400.
  The expectations changed are exactly those named in 7.1 (`style-examples` "sizes" and the one
  `size-step` example; `style-oracle`'s `step`; `style-acceptance` only lost its import).
- 7.1: `fmwriter.ts` imports `hasBrokenFrontMatter` from version 1's `idwriter.ts`, which is not
  ported. That one function is ported alone, as `core/src/frontmatter.ts`.
- 7.3 intents are objects with a `type` field named as in the spec, and the arguments named as
  in its notation: `{ type: "insertText", text }`, `{ type: "setMark", change }`,
  `{ type: "setBlock", kind }`, `{ type: "setList", kind }`, `{ type: "setLink", href }`,
  `{ type: "insertBlock", what }`, `{ type: "insertPhoto", file }`,
  `{ type: "setImageWidth", at, value }`, `{ type: "toggleTask", at }`,
  `{ type: "tableEdit", at, op, pending? }`, `{ type: "setMeta", key, value }`,
  `{ type: "paste", plain, markdown? }`, `{ type: "applyStyle", style }`; the others have no
  arguments. `window.__notes.intent` also accepts a bare name for those (`"enter"`) and a few
  other spellings (`core/src/normalize.ts`).
- 7.3 `toggleTask(at)`: the routine (`widgets.ts` `toggleTask(text, pos)`) takes a **source
  position on the task's line**, not the index of a visible character as the table says. The
  code wins: `at` is a position in the text. (`setImageWidth`'s `at` is a visible index, as
  its routine takes it.)
- 7.5 "Delete at the end of a block ... a line below is refused": `deleteAt` forward before a
  horizontal line does not refuse; it moves the caret to the start of the line's row
  (`deleteBetween`). The scenario records what the code does.
- 7.4.2 `edit`: the shortest common-prefix-and-suffix range can slide past the end of a region
  when the inserted text begins like the text after it (front matter `---` added before a note
  that starts with `- item`). `reduce` checks the rule as stated (bytes outside the region are
  identical) and then gives the range inside the region (`region.ts` `editWithin`).
- 7.4.3 / 9.4: version 1's toolbar and `styleToCarry` worked out the note's size from the
  `size` setting with their own formula; `core` uses the format's own `noteSizeOf`
  (`runs.noteSize`), which is what the routines' `natural()` already used.
- 7.7 a `tableEdit` that leaves every cell as it was writes nothing; otherwise `replaceTable`
  rewrites the whole table, including its separator row as `| --- |` (version 1's
  `writeTable`).
- 7.7 `styleCell` with `on: false` over a cell selection that is partly styled calls
  `styleCellText` twice (on, then off), because the routine toggles and turns a mixed
  selection on.
- 7.3 `describe(doc, model)` does not know the mode, so `can` cannot grey out the style buttons
  in Raw with nothing selected; pressing one there gives the refusal "Select some text first".
- 7.6 Shift+Enter on an empty line: `lineBreak` calls `enter` there, as the spec says.
- 7.6 "a tag is lower-case a-z": a new tag is cleaned as version 1's tag box cleaned it
  (capitals to lower case, other characters dropped, at most 30). A tag already in the note
  that has other characters is kept as written by `setMeta`, so it can be shown and removed.

## Sections 4 to 6 (server)

- 6: a wrong current password on `POST /api/password` answers **422** (`wrong-password`); the
  status table keeps 403 for a wrong `Origin` and 401 for no session, and neither fits.
- 6: a changing request with a body that is not JSON, `text/markdown` or multipart answers
  **415** (Fastify's own status for it); the table has no line for it. A path part longer than
  100 characters answers 414 (Fastify's router limit).
- 6: `POST /api/notes` (create) answers `{ id, revision, entry, text, photosMissing }`: the text
  is added so the browser can open the new note without a second request.
- 6: `GET /api/fonts/catalogue` also answers `categories` (for the category filter) and
  `available` (false when Google's list could not be fetched and none is cached, instead of an
  error, so the screen can say so and offer "Try again"). A page is 30 families.
- 6: the font catalogue is fetched under the same 5 MB limit as every fetch (section 5);
  version 1 allowed 10 MB for it. Google's list is about 2.7 MB.
- 4.3: a new note's `created` is the server's date (UTC): `POST /api/notes` takes only
  `{ title? }`.
- 4.5: search matches title, tags and text; the excerpt is around the first match in the text,
  or the start of the text when only the title or a tag matched.
- 6: a photo's stored name drops the characters outside `A-Z a-z 0-9 _ -` (version 1 turned
  each run of them into a hyphen); the spec says "reduced to".
- 5: login and password bodies are limited to 1 KB; a larger one answers 413.

## Sections 8 to 12 (web)

- 7.1 / 12: **a bug in version 1's `typeText`, fixed after a scenario was added** (as section
  12 asks): typing over a selection at the start of a paragraph lost the space after it
  (`Hi there`, `Hi` selected, `x` gave visible `xthere`). Deleting first left a leading space
  that does not show. `typeText` now first tries replacing the selected characters where they
  are, under the same checks; the typed text takes the look of the first selected character.
  Scenarios: "bug: over a selection at a block's start" in `core/test/scenarios.test.ts`.
- 9.2: the trash list and a note's versions live in the `library` store (the table of 9.2 has
  no store for them, and only store actions may call the API client).
- 9.2: the confirmation in view ("Leave without saving?", "Empty the trash?") lives in the
  `toasts` store, which owns messages.
- 9.3: under 640 pixels, whether the sidebar's sheet is open over a note is kept in `prefs`, not
  saved.
- 10: Svelte's component styles are not in a CSS layer; unlayered styles rank above every layer,
  which is where `components` stands. The layer order `reset, tokens, base, components` is
  declared first in `styles/base.css`, and `base` holds `paper.css` (imported with
  `layer(base)`) with its surface variables mapped to tokens.
- 10: `paper.css` styles `body` for a page of its own (padding, paper colour); `base` resets
  that for the app.
- 11: the header's New note button has no test id: `new-note` is the sidebar's, and two would be
  ambiguous. The "Default (reset)" choice of the Styles list is `menu-item` with
  `data-value="reset"`. Highlight choices have the colour's name as `data-value` (`yellow`), and
  write its hex value. A task box also carries `data-checked`; a photo `data-width`.
- 11: drafts offered when a note opens use `draft-row`, `draft-open` and `draft-discard`, as the
  home screen's list does.
- 8: the composition's history boundary is `history({ joinToEvent })` refusing to join
  `input.type.compose.start`; CodeMirror itself always joins `input.type.compose` events, so the
  finishing transaction joins the composition.
- 8: in Rich mode CodeMirror's `standardKeymap` is used for movement keys (arrows, Home, End,
  page keys); the editing keys are taken first by the intent keymap, and anything else that
  would change the text is dropped by the filter. Raw mode has the default keymap.

## After acceptance (2026-11-12)

- 7.7, a bug found by alpha's acceptance tests: text typed in a table cell was written only
  when the cell was left by Tab or Enter. Leaving it any other way (a click in the text, in the
  search box or on another cell, Save, Ctrl+S) cleared "the focused cell" before reading it, so
  nothing was written, and Save saved the note without the text. Fixed: the focused cell's logic
  is `CellFocus` in `web/src/editor/table.ts`, which reads the cell while it is still the
  focused one; Save calls `flushActiveCell()` first; Ctrl+S in a cell writes the cell and then
  saves. Tests: `web/test/cells.test.ts` (Node) and `e2e/cells.test.ts` (Chromium), one case per
  way of leaving, plus a style and the row and column buttons with unsaved text (those already
  carried it as `pending`). The five e2e cases fail on the bundle before the fix.

## Code review fixes (2026-11-12)

- 9.5, finding 5 (alpha's choice): opening an offered draft when text was typed since the note
  opened asks first; on OK the typed text is kept as a second draft of the same note, under a new
  editor id, and is offered the next time the note opens. The spec says opening a draft stores it
  under the current editor id; it does not say what happens to that editor's own newer text.
- 9.5, finding 4: when Take theirs cannot store the person's text (storage full), the editor takes
  a new editor id, so a draft it stored earlier is not removed and is offered next time.
- 4.7, finding 6: text typed while Save as a new note is out is stored as a draft of the new note
  (base: the new note's revision), offered when it opens.
- 9.3, findings 9c and 35c: under 640 pixels the sidebar's fold button at home folds it away to
  show the welcome and the drafts found; the welcome's notes button brings it back. Over a note
  the open sheet makes the note under it `inert`.
- 9.5, finding 7: the warning "This browser is refusing to keep drafts" also shows when there is
  no local storage at all; its text says "(its storage is full or turned off)".
- 5, finding 10: the `Origin` check compares scheme, host and port with the request's own; behind
  Caddy the scheme is its `X-Forwarded-Proto`, trusted only from Caddy as `X-Forwarded-For` is.
- 5, finding 12: a password check under way counts against the limit of 5 like a failure.
- 6, finding 13: an upload waits for its processing place before its body is read, and keeps it
  until the photo is stored.
- 6, finding 34: `POST /api/notes` limits a JSON body to 64 KB, though it takes 2 MB of Markdown.
- 6, finding 35d: `styles.json` is read entry by entry; entries the app does not show (one that
  does not check, or past the 50th) are written back as they were, and a file that is not a JSON
  list is never replaced (409 `damaged`).
- 4.3, finding 32: reading a trashed note that is not UTF-8 answers 422 `not-utf8`.
- 13, finding 15: Caddy runs as root inside its container (with `no-new-privileges` a non-root
  Caddy could not bind 80 and 443) but with a read-only root and every capability dropped but
  `NET_BIND_SERVICE`; the Caddyfile has `skip_install_trust`.
- 5: the 20-second limit on fetches from Google is the setting `fontFetchMs` (20 s; tests set less).
- 7.4, finding 20: the toolbar and widget intents are refused when the selection starts in the
  front matter (Raw mode); only `setMeta` writes it.
- 7.4.6, finding 21: `setMeta` keeps positions after the front matter at their place in the text.
- 7.6, finding 22: `−` and `+` leave a size already past 1 or 400 as it is.
- 7.1 / 12: bugs of ported routines, each fixed after a scenario (core `review.test.ts`):
  `leaveCode` took the first fence-like line as the closing fence (17); `setList`'s adapter read
  the list kind of every touched block, where `toggleList` reads the paragraphs only (found by
  the property test); `typeOver` (version 2's) now also tries the source widened over hidden
  markup at the selection's ends and restyles the typed text to the wanted look (found by the
  generated test of finding 38).
- 8, finding 41: undo and redo keep the caret at stops through `atStops` (CodeMirror's history
  dispatches with `filter: false`, past the caret-stop filter).

## Added after the build: paragraph spacing per note

Not in SPEC2. Note settings has "Paragraph spacing". It is kept in the front matter as
`spacing: <number>` (0 to 5, one decimal at most), a multiple of the usual gap between
paragraphs; no key means 1. `noteformat` does not know the key and keeps it (SPEC.md: unknown
keys are kept), so the app reads it from the mapping itself (`core/src/fmwriter.ts`). It changes
the height of the blank line between blocks in Rich mode only (`.rich-gap` in
`web/src/editor/theme.ts`); the reading views of History and Trash and Raw's preview do not use it.
The values offered are 0.3, 0.6, 1, 1.5, 2 and 3 (`SPACINGS` in `EditorScreen.svelte`, test id
`note-spacing`); any value from 0 to 5 written by hand is shown and kept, and one that is not
valid makes the setting read-only.

## Alpha's changes after the build (2026-11-12), and the review of them

The user asked for these 16 changes (`CHANGES-REVIEW.md`) and has seen them working; the fixes
of the review (`CHANGES-REVIEW-FINDINGS.md`, outcomes in `FIXES.md`) keep each of them. SPEC2.md
is not rewritten; where they depart from it:

- **1, the folder (SPEC2 header, 2, 16).** The app is no longer in `v2/`: `packages/`, `e2e/`,
  `scripts/`, the Docker files and these documents are at the top level, beside `noteformat/`.
  Version 1 (`app/`) and its stack are gone; Compose project `notesv2` serves ports 80 and 443
  (`docker compose up -d --build`, then https://localhost).
- **New test ids (SPEC2 11),** kept as part of the contract: `note-spacing` (Note settings'
  paragraph spacing), `cmd-invisibles` (the `¶` button), and `photo-handle-e`, `photo-handle-w`,
  `photo-handle-s`, `photo-handle-sw` beside `photo-handle` (the lower right corner).
- **6, the font menu (9.4).** The person's fonts first, in alphabetical order, then Mono, Sans and
  Serif. There is no "Default": choosing the note's own font takes the text's own font away.
- **12, the line under a table (7.6).** A table inserted where nothing but blank lines follows
  gets an empty line under it, so the caret has somewhere to go; blank lines that were there are
  kept. A click under a table that ends the note is the intent `lineAfterTable` (new, not in
  7.3): reduced and checked like the others; it adds only line ends at the note's end, until a
  blank line follows the table's last line, and puts the caret at the end; it is refused when
  the note does not end in a (top-level) table. In Rich mode the click is the only way to send
  it; `window.__notes.intent("lineAfterTable")` sends it too.
- **13, blank lines after the front matter (8).** Only the front matter and the one blank line
  after it are hidden. Further blank lines (Enter on an empty note) are shown, are caret stops,
  and Backspace and Delete remove them, as any blank line: core and web use one `bodyStart`
  (`core/src/region.ts`). Backspace at the start of a note's first block removes a blank line
  shown above it.
- **8, `spacing`:** the section above.
- **14, the invisibles button (9.4).** `¶` in the toolbar, its own group, shows a dot for each
  space, `°` for each kept space (below), an arrow for each tab and `¶` at each line end, in both
  modes; the last line has no line end and so no `¶`. It is drawn only; the text is not changed.
  The choice is kept in this browser (`stores/prefs.svelte.ts`), not in the note.
- **15, the kept space (7.4.4).** 7.4.4 tries typed text in three encodings and refuses it when
  none passes. A space or tab typed where Markdown drops it (an empty line, a paragraph's start)
  has a fourth: it goes in as U+00A0 (a tab as four), which Markdown keeps and shows; the
  routine's own checks are run on it. Nothing else typed is changed. The rule for U+00A0
  everywhere (`core/src/style/blank.ts`):
  - It is **content**. Markdown's white space is the space, the tab and the line ends only (a
    paragraph drops them at its ends; a line of them is blank). No code counts U+00A0 as blank
    or drops it: the typing routines (Enter, a line break, a deletion next to it), Insert, the
    line under a table, the gaps drawn between blocks, a block style waiting for the first
    typed text (a typed U+00A0 starts it).
  - To the person it is **a space**: it separates words (Ctrl+Backspace), the server's search
    matches it with a typed space and the other way round, a plain-text copy gives an ordinary
    space, and a table cell keeps it as a space (as before). The app's own clipboard Markdown
    keeps U+00A0, so a copy and paste inside the app keeps it shown.
- **4, the toolbar's colours (10).** One colour per group, from new tokens `--group-0` to
  `--group-6` and their `-soft` shades in `tokens.css` (the tag colours `--tag-N` stay as they
  were): each passes 4.5:1 for `--accent-ink` on it, for it on `--surface`, and for `--ink` on
  its soft shade, in light and dark.
- **7, the waiting size at the caret (7.4.3).** A size or font chosen with nothing selected puts
  an empty span of that size at the caret; while an IME composes there, the line carries the
  size and font for the text being composed, so it does not jump when the composition ends.
- **9, photo handles (9.4).** Five handles (the sides and the lower corners), shown when the
  photo is under the pointer, always on a touch screen (there inside the photo's edges); a
  handle not shown takes no clicks. The corner handle is the photo's width slider for the
  keyboard (arrows by 5%, Page Up and Down by 20%, Home 5%, End 100%; each change is one
  `setImageWidth`); the other four are hidden from screen readers.
- **10, tables (8).** A table in Rich mode sits at the left, as wide as its cells, drawn as one
  table, its text at the note's size.
- **11, a new table (7.7).** Insert, Table puts the focus in its first cell with "Column 1"
  selected, in the same task as the insert. Tab and Enter into a cell select its text. When a
  cell's write is refused, Tab and Enter stay in the cell (the refusal is shown; Escape
  discards).
- **7.4, a fix found on the way:** `setMark` with bold, italic, underline or strike that every
  selected character already has (or, turning it off, none has) changes nothing; version 1's
  routine wrote the same look again in other markup, so the setting was not idempotent (found
  by the property test once it generated `spacing` and `lineAfterTable`).

## Added after the build: running with no settings file

SPEC2 13 has the settings in `.env`. `compose.yaml` now has a default for each, so the app runs
with `docker compose up -d --build` alone: ports 9987 and 9988, the address `localhost`, logs to
`json-file` (the spec's `journald` is one line in `.env`). The file names its own project, so
`-p notesv2` is no longer written in any command.

## Changed after the build: a password has at least 5 characters

SPEC2 5 asks for 12. The user chose 5 (2026-11-12). The limit is `LIMITS.passwordMin` in
`contract/src/index.ts`; the login failure limits of section 5 are unchanged.

## Changed after the build: the data is in `./data`, not in Docker volumes

SPEC2 13 keeps the data in named volumes and runs the app as user 10001. The user asked for a
plain folder (2026-11-12). `compose.yaml` now binds `./data/notes` to `/srv/notes` and
`./data/caddy`, `./data/caddy-config` to Caddy's two folders. The app and the backup run as
`PUID:PGID` (1000:1000 by default) so that the files belong to the person who owns the folder,
and a one-shot service, `owner`, gives `./data/notes` and the admin socket's volume to that user
before the app starts (Docker makes a missing folder as root). The one named volume left,
`notes-run`, holds only the admin socket. The container hardening of section 5 is unchanged.

# Notes on SPEC-DRAWINGS.md (draft 5)

Where the drawings build departs from `SPEC-DRAWINGS.md`, or that document was silent. Section
numbers are that document's.

## Section 2: the first step (2026-11-12)

A temporary page (`/spike`, removed again) mounted Excalidraw 0.18.1 from the production build
(`npm run build`), served by the real server under the policy of 3.2, and was driven in
Chromium through Playwright (with internet access). Found:

- **It works under the policy as written.** It drew a rectangle, typed text, took an image by a
  drop (kept in `files` as a `data:` URL), embedded a YouTube page (`frame-src https:`), opened
  the library sidebar, took in a library sent back in the address, and inserted a Mermaid
  diagram. **The policy blocked nothing**: no directive was added. Opening a note requested no
  Excalidraw file.
- **Fonts.** Excalidraw's font faces (Excalifont, Virgil, Nunito, Lilita, Comic Shanns,
  Cascadia, Liberation, Xiaolai) are fetched from `window.EXCALIDRAW_ASSET_PATH` +
  `fonts/<Family>/<file>.woff2`, so from `/assets/excalidraw/fonts/…`; only if that fails does it
  fall back to `https://esm.sh/@excalidraw/excalidraw@0.18.1/dist/prod/`, which was never asked
  for. The four Assistant faces of its own interface are `url()`s in its CSS, which Vite bundles
  as hashed files in `/assets/`. `.woff2` was already in `ASSET_TYPES`; nothing was added. The
  one font from another address in the whole run (Roboto from `fonts.gstatic.com`) was asked
  for by the embedded YouTube page inside its own frame, not by Nook's page: the e2e case
  counts the main frame's requests only.
- **Vite needs no `define`.** The package's production build has its environment values
  written in; the bundle builds and runs without `process` or `import.meta.env` values. Vite
  warns about the `"use client"` directives of Radix modules; the warnings are harmless and are
  silenced in `vite.config.ts`.
- **CSS.** `cssCodeSplit` is now `true`: Excalidraw's CSS (about 140 KB) is its own file,
  `mount-*.css`, loaded with `mount-*.js` (about 1.3 MB, with React and further chunks loaded on
  demand: Mermaid, KaTeX, the font subsetting worker, locales). Its rules outside `.excalidraw`
  are qualified by its own class names (`.exc-stats .title`, `.zoom-actions`,
  `.LoadingMessage`, …) and `:root` custom properties (`--zIndex-*`, `--sa*`) that no token of
  the app uses; none restyles the app, so no override was needed.
- **Opening a scene changes no element's version.** A scene with a rectangle and its bound
  text, free text in each of the nine font families, and an image was taken out of Excalidraw,
  then opened again by a page load, twice: after the scene, `document.fonts.ready` and one
  frame, and again three seconds later, every element had the version it was saved with.
  `onChange` is called twice on opening with nothing changed, which the signature of 4.3
  ignores. The baseline is still taken at the moment 4.3 names.
- **Real names in 0.18.1:**
  - Props: `initialData` (`elements`, `appState`, `files`, `libraryItems`, `scrollToContent`),
    `onChange(elements, appState, files)`, `onLibraryChange(items)`, `libraryReturnUrl`,
    `excalidrawAPI(api)`, `viewModeEnabled`, `theme`, `aiEnabled`, `isCollaborating`,
    `UIOptions.canvasActions` (`toggleTheme`, `saveToActiveFile`, `loadScene`, `export`,
    `saveAsImage`, `clearCanvas`, `changeViewBackgroundColor`), `renderTopRightUI` (not given,
    so there is no collaboration button).
  - The menu: `MainMenu` with `MainMenu.DefaultItems.LoadScene`, `Export`, `SaveAsImage`,
    `SearchMenu`, `Help`, `ClearCanvas`, `ChangeCanvasBackground` (and the ones Nook leaves
    out: `LiveCollaborationTrigger`, `Socials`, `ToggleTheme`, `SaveToActiveFile`,
    `CommandPalette`). Giving a `MainMenu` replaces the default one.
  - The API: `getSceneElementsIncludingDeleted()`, `getSceneElements()`, `getAppState()`,
    `getFiles()`, `addFiles(files)`, `updateScene({ elements, appState, captureUpdate })` with
    `CaptureUpdateAction.IMMEDIATELY | NEVER`, `history.clear()`.
  - `appState` keys: `viewBackgroundColor`, `gridSize`, `gridStep`, `gridModeEnabled` (as 4.2
    names them).
  - Library: `useHandleLibrary({ excalidrawAPI })` takes in `#addLibrary=<url>&token=…` (it asks
    "This will add N shape(s) to your library. Are you sure?" with `window.confirm`, then removes
    the hash); by default it accepts only libraries from `excalidraw.com` addresses.
  - An image element Excalidraw makes from a drop has `status: "pending"` (excalidraw.com marks
    it `"saved"` once its own backend has the file); it is drawn either way, and Nook keeps the
    status as Excalidraw gives it.
- **The AI features** are hidden by `aiEnabled: false`: "Text to diagram" and "Wireframe to
  code" go; the tools menu keeps its heading "Generate" over "Mermaid to Excalidraw", which is
  not an AI feature. **Excalidraw+**: with Nook's own `MainMenu` there is no link to it but the
  help dialog's "Blog" button (`plus.excalidraw.com/blog`), hidden by CSS.

## Section 5 and 8: the contract

- `BodyKind` keeps `"markdown"` and `"json-or-markdown"` beside the new `"document"` and
  `"json-or-document"` (no route uses the old two now). `contract` also has `Kind`,
  `DRAWING_TYPE`, `DOCUMENT_TYPE` (each kind's body type), `kindOfType` and `KIND_LIMITS` (each
  kind's bytes and history), so the server and the browser take a kind's numbers from one place.
- Section 8 says no other existing test changes. One more had to: the test that every route
  needing a session answers 401 (`server/test/refusals.test.ts`) builds each request from the
  route's body kind and sent a Markdown body only to a `"markdown"` route; it now does the same
  for a `"document"` route, the new name section 5 gives the body of a save. Without that it
  sends JSON to the save route, which is refused with 415 before the session is looked at.

## Section 4 and 5: the server

- The two document routes take up to 25 MB **plus 64 KB** (as the photo route has), so that a
  drawing just over 25 MB is refused by the kind's own check, whose 413 carries the drawing's
  size (`size`, `limit` beside `error`), rather than by Fastify's route limit.
- `PUT /api/notes/:id` checks, in order: the item exists (404, 410); the body type is the item's
  kind (415); the bytes are within that kind's limit (413); the revision (409); then the rest of
  the new bytes (422). A note's 413 now comes after 404 and 410 (it came first, from the route
  limit of 2 MB); for a note within 2 MB nothing changes.
- The 422 codes of a drawing are `not-utf8`, `not-json` (not JSON, or JSON that is not an
  object) and `not-excalidraw` (no `type` "excalidraw" or no array `elements`).
- A folder whose `note.md` is not a regular file but whose `drawing.excalidraw` is, is a
  drawing (4.1: "without one" is read as without a regular `note.md`).
- Save as a new drawing with images filled in from the source writes the draft's JSON again
  with `files` replaced (its other keys as sent); without anything to fill in, the bytes are
  kept as sent. Only a source that is a drawing gives images.
- The photo upload answers 404 for a drawing once the photo has passed its type check (a file
  that is not an image is still 422 first, as for a note); asset routes answer 404 for a live or
  trashed drawing.

## Section 3 and 6: the browser

- **Ready (4.3)** is: Excalidraw's `appState.isLoading` is false (it turns false in the same
  update that puts in the initial scene), every image's `data:` URL is decoded, a frame, then
  `document.fonts.ready`, then a frame. The view registers with the store only then, and the
  store takes the baseline as it registers.
- **Take theirs, opening a draft and another version on the history screen** mount Excalidraw
  again with the new scene (React key), so the new scene goes through exactly the path of
  opening (Excalidraw's `restore`, its fonts, the same signal of ready); the view position
  goes back to "scroll to content" each time. While it remounts the view answers with the scene
  it is loading, so a draft stored meanwhile is never empty.
- **Take theirs** of a drawing keeps the person's scene as a draft (4.5) and says so in a
  message; there is no box with the text to copy (a note's "rescued" box would hold JSON).
- **The library (3.3)** is read into `initialData.libraryItems` and written on
  `onLibraryChange`, under `nook:library:<user id>`; `useHandleLibrary({ excalidrawAPI })`
  takes in `#addLibrary=…`. A library is taken in only after Excalidraw's own `window.confirm`,
  and only from `excalidraw.com` addresses (its default). Library items can also be added the
  usual way (select, then "Add to library" in the library sidebar).
- **The title** of a drawing is changed by clicking it, as a note's; an empty title is not
  taken (the old one stays). Tags are cleaned as a note's.
- **A wrong-kind address.** `editor.open(id, expected)` leaves `loading` set and goes to the
  right address with `replace` when the item is of the other kind, so no view is made. The two
  history screens do the same from the kind the list (or one read) gives.
- **The history screen of a drawing** uses the page layout, full width, with Excalidraw in view
  mode in a box 70% of the window high.
- **Dark mode:** Excalidraw's theme follows `prefers-color-scheme` when the drawing opens, as the
  app's tokens do. The theme item of Excalidraw's menu is left out, since Nook has no theme
  setting of its own.
- **Icons:** the drawing rows and trash rows use a new `pen` icon.
- The test hook's `addImage(file)` drops the file on the canvas, as a person's drop;
  `addText(text, x, y)` adds a text element made by Excalidraw's `convertToExcalidrawElements`;
  `setBackground(colour)` sets `viewBackgroundColor`. Each is one undo step.

## Section 8: the tests

- The e2e cases find Nook's own controls by test id only. Excalidraw's controls have none, so
  the cases that work inside it use its class names: its canvas
  (`canvas.excalidraw__canvas.interactive`, for drops), the library button (`.sidebar-trigger`)
  and the pending library item (`.library-unit__pulse`), and the library grid's items. A scene
  file "loaded from disk" is dropped on the canvas: Chromium has the File System Access API, so
  Excalidraw's Open menu uses the system's file picker, which a test cannot drive.
- "An image added, saved, reloaded and seen" and the file from excalidraw.com check that the
  image is drawn by counting red pixels in a screenshot of the drawing.
- "No font comes from another address" counts the requests of Nook's own page (its main frame):
  an embedded web page may fetch fonts in its own frame.

## After the code review of drawings (2026-11-12)

Twelve reviews (`../codereview/`); each finding's outcome is in `../codereview/RESPONSE.md`.
What changed in behaviour:

- **A drawing is written only from a ready view of a file that could be read** (4.3, 4.6). The
  store refuses a save, and Save as a new drawing, of a broken file or while the view is not
  ready (also while it remounts for Take theirs or a draft), whatever asks for it: Ctrl+S too.
  Ctrl+S first takes in a title or tag still being typed in the header.
- **The title and tags can be changed only once the drawing is ready,** and the baseline takes
  the title and tags of the file read, so no change can become the baseline.
- **Take theirs of a drawing refuses** when the person's scene cannot be kept as a draft (the
  browser refuses to store it), or when the newer file is not a scene; the drawing and the
  choice stay, and a message says why.
- **The view's `flush()` always tells the store from the live scene.** Excalidraw reports a
  change only after React has drawn it, so a change made in the same task as Save or leaving
  had not reached the throttle yet.
- **The drawing history screen shows the version picked last,** also when it was picked while
  Excalidraw was loading; Restore is enabled only once the version shown is the one picked. Its
  canvas stays in the page (hidden when nothing is picked), and it has "Try again".
- **The two history screens** look an item up when a list narrowed by a search or a tag does
  not have it, to go to the right one; the versions of another item are never left listed.
- **New note and New drawing ask first** when the screen has unsaved changes, before the item
  is made, so cancelling leaves no empty item.
- **After Save as a new note or drawing,** leaving the old one stores no draft of it.
- **The shape library is shared by the browser's tabs:** a change written by another tab
  (the `storage` event) is taken into this tab's library, so its next change does not write
  over it.
- **A failure inside Excalidraw** (an error while drawing, or not ready within 60 seconds) shows
  "could not be loaded" with Try again, rather than "Loading" for ever; a load replaced by a
  newer one resolves with it. Ready no longer stops waiting for Excalidraw's scene after 600
  frames.
- **A note saved as new from a drawing's id** takes no photos from it, so its photos are
  reported missing.

# Notes on SPEC-AGENTS.md (draft 4)

Where the agents build departs from `SPEC-AGENTS.md`, or that document was silent. Section
numbers are that document's. Section 6 (the short form for drawings) is not built.

## Section 2: tokens

- A bad name is 400 with the code `bad-name`. An unknown value in the body of
  `POST /api/agents` is dropped, and a number for `name` is read as its digits, as Fastify
  does on every route.
- `agents.json` is `{ "agents": [ … ] }`. A file that is not JSON, or not that shape, is an
  empty table and is logged: no token works until a person makes one.
- The token of an `Authorization` header is read without regard to the case of `Bearer` or
  the spaces after it.
- Writing a token's last use happens inside the request that finds it stale by an hour, under
  the accounts lock. If the write fails the request goes on.
- A token's id is 16 base-32 characters (`PATTERNS.agentId`).
- **Tokens are kept, and shown on the Account screen for as long as the agent exists** (the
  owner, 2026-11-13, after the build; SPEC-AGENTS 2.1 and 2.2 are changed to say so). The
  screen no longer has a token shown once with a Close button: each row has its token and a
  Copy button, and the guide's address is above the list with one too.
- The Account screen's test ids are those of section 8 and `agent-guide`, `agent-guide-copy`, `agent-no-token`,
  `agent-error` and `password-revokes`.

## Section 3: the boundary

- **A request is checked against its route's schema before its token.** So a request with a
  malformed id and no token is 400, not 401, as on the browser's routes. With an address that
  fits its route, the order is that of 5.6.
- **The body-type check comes before the token too** (it is in `onRequest`, the token in
  `preHandler`): a request with no `Content-Type`, or the wrong one for its route, is 415
  whether or not it has a token, and is not counted toward the limits of 3.3. It writes
  nothing. The review of the build pointed this out; the order of 5.6 holds for a request with
  the body type its route takes.
- **An address value a route does not have is dropped,** not refused, as Fastify does on every
  route: `?from=…` on create does nothing.
- **Counting (3.3)** happens when the token is accepted, which in Fastify is after the body
  has been received. The bytes counted are the body's length. A request refused for either
  limit counts toward the minute, and adds no bytes to the day (the spec says a refused
  request's bytes count; nothing of it reaches the disk). The wait a 429 names is until this
  refused request and enough before it have left the minute, so a request sent then is let in. The 429 for bytes carries `size`, `used` and `limit` beside `error`.
- `empty` and `missing-image` are in `space.save`, which applies them when it is given a
  writer. They are skipped when the file being replaced cannot be read as text or, for a
  drawing, as JSON. The 422 `missing-image` carries `file`; `bad-tag` carries `tag`.
- A file id is counted as held only when it is the `files` object's own key.

## Section 4: who wrote what

- The steps of a save have two more names for the tests: `save:writers` (after 5a) and
  `save:pruned` (after 7).
- **The index forgets an item whenever its `writers.json` is written,** so the next read takes
  the writer from disk even when the main file is the same. Without this a save stopped
  between 5a and 6 left the list showing the old mark until the file next changed.
- `writers.json` that is a folder or a link is read as not valid. A person's save with nothing
  to record writes no `writers.json`, so an item no agent has touched never gets one.
- **Step 5a failing for an agent's save** (the file valid and readable, yet not replaceable)
  has no test: no way was found to bring that state about without also stopping step 5. The
  case where it can be neither read nor written is tested: every text is then a person's and
  saves go on.
- **A person's save stops too when step 5a fails and its bytes are those a stale `current`
  names** (the review of the build): a person saving, after a hand edit, the very bytes an
  agent once wrote, while the old record cannot be cleared. Going on would have left the
  person's save counted as the agent's. Like the case above, it has no test.
- When step 5a fails for an agent's save, the version file that step 5 made stays: one extra
  copy of the current text, as SPEC2 4.4 already allows after a crash.

## Section 5: the interface

- `{{SERVER}}` in `agent-guide.md` is where the server's address goes.
- `GET /items/:id/text` answers 422 `not-utf8` for a file that is not UTF-8, as the JSON read
  does: it does not send bytes it cannot check.
- A create with the drawing type and no body is 422 `not-json`. Only a note can be made empty.
- The title of 5.5 is trimmed and otherwise kept as sent (not collapsed as the browser's
  create does). Its limit of 300 counts characters, not bytes.
- An `If-Match` that is not a revision is 400 on append too.
- Append to a note that is not valid UTF-8 is 422 `not-utf8` with a hint that a person must
  mend it.
- A hint is added by the error handler for every answer of 400 or above on an agent address.
  A schema failure's hint is Fastify's own message, which names the part at fault
  (`params/id must match pattern …`), and the guide's address.

## After the review of the build (2026-11-13)

Seven AI models reviewed the build (two more did not finish). None found a way for a token to
delete, to reach another person, or to remove a person's version. What changed:

- A person's save stops when step 5a fails and its bytes are those a stale `current` names
  (above).
- A kept space (U+00A0) is content in the checks for an empty note and an empty append.
- The wait a 429 names was one request short; the day's hint says when the request would fit.
- The Account screen's list of agents, and a token still shown or on its way, go when the
  session ends; while a token is shown another cannot be made.
- A burst of requests writes a token's last use once. A body past a route's own limit says
  its size and the limit in the hint.
- The guide no longer says that every save's text is kept (agents' versions are the newest 10
  or 5), that append changes nothing of the note (it tidies the end), or that the app measures
  a drawing's text; and its `empty` row tells an append to send only the new text.

## Section 9: the tests

- "Every `curl` example of the guide" is run by reading each `curl` line of the guide and
  sending the same request to the server in the test process (`fastify.inject`), with `$ID`,
  `$REVISION` and `$VERSION` taken from the answers before, in the guide's order. `curl`
  itself is not run.
- The e2e agent is the test's own `fetch` against the real server, with a token and no
  cookie.
- "A crash after each step of 4.3" stops the save by throwing at the step, in the same
  process, which leaves the disk as a crash there would; the server is not restarted.

## Save and Move to trash in the header (2026-11-13)

Departs from SPEC2 3 (item 4) and 9, and from SPEC-DRAWINGS 6. On the note screen and the
drawing screen alike, the header ends with a divider, then **Save**, then **Move to trash**,
both as icon buttons with their names as labels and tooltips (`save`, `note-trash`).

- Save is muted (the surface colour, soft ink) while the save status is `saved`, and the
  accent colour in every other state (`dirty`, `saving`, `error`). It is never disabled for
  being saved.
- Move to trash is no longer in Note settings; History stays there. On the drawing screen
  History is before the divider.

## A saved style with a heading (2026-11-13)

Found by trying the app: a saved style and a heading chosen for the same line gave a styled
paragraph. A style on a whole paragraph is an attribute line under it (`{color=red}`), which
is inside the paragraph's range, and a heading was refused for any paragraph of more than one
line of source. What changed, in `core`:

- **A paragraph's attribute line is not one of its lines of text.** A paragraph of one line of
  text with an attribute line under it becomes a heading (`setBlockStyle`); the line stays
  under the heading, as its own. So a styled heading also changes level, which goes by way of
  a paragraph. Text of several lines is refused as before.
- **A block chosen on an empty line that the first letter cannot start** (a quote or a code
  block with a style that is an attribute line) is still typed as a paragraph, and the person
  is now told why, as a skipped part (7.4 said nothing; it was dropped in silence). The
  message for one skipped part reads "One part was left as it was".
- **A saved style that names no size leaves the size the block gives,** as "Default (reset)"
  does (9.4): a heading keeps its size. It set the note's size before, which shrank headings.
  A selection over blocks of several kinds still gets the note's size.
- **A style waiting at the caret outlives a change of block** (departs from 7.4.3, "any other
  change to the text clears them"): with nothing selected, a saved style and then a heading
  on a line that has text makes the line a heading and keeps the style for what is typed
  next.
  A waiting size that is only the block's own (a style that names no size; the size change
  is marked `own`) becomes the new block's, and the note's size in the paragraph Enter makes
  out of a heading (the heading's, in the second half of a heading that Enter splits). A
  size the style names is kept as it is. With a heading waiting on an empty line, the size
  box shows the heading's size for such a style. Nothing is
  left waiting when the line becomes a code block.

Not changed: a selection over blocks of several kinds still gets the note's size from a style
that names none; and a code block takes no style, so one chosen with a style on an empty line
is refused with the message above.

## A saved style with a quote or a list (2026-11-13)

The note format has no attribute line in a quote or a list item, so a paragraph whose style
is one was refused as either ("the visible text would change"), and on an empty line the
quote was dropped. What changed, in `core`:

- **The style goes into spans** (`keepingStyle` in `reduce.ts`). When a quote or a list is
  refused for paragraphs with attribute lines, those lines are taken off, the change is made,
  and each character is given its colour, highlight, font, size and underline again by
  `applyStyle`, which writes spans there: `hello` with `{color=red}` under it becomes
  `> [hello]{color=red}`. It is accepted only when the visible text and every character's
  style are the same after as before; otherwise the first refusal stands. Back out of the
  quote or the list, the spans stay spans.
- **A list chosen on an empty line keeps a waiting style** (`setList`), as a change of block
  does: a style and then a list, or a list and then a style, both style what is typed.
- **After a change of block the caret stays in its block.** With the caret at the end of a
  block that had another under it, it was put at the start of that next block: text typed
  after choosing a heading on an empty line above other text went into the paragraph below.
  It is kept after the visible character it is after (`result` in `blocks.ts`, which now
  counts only the characters the person sees, so leaving a code block is right too). In a
  new code block that is after the text, not on the closing fence's line.
- **An image's width line is not a style.** A paragraph that is only an image, with
  `{width=...}` under it, is refused as a quote, a list item or a heading, as before.

## A look waiting at the caret, and a block chosen there (2026-11-13)

Departs from 7.4.3 and replaces "A style waiting at the caret outlives a change of block"
above. The complaint: "I created a style and it was selected, then I chose a quote, and the
quote was plain." With the caret in a line of text and nothing selected, the toolbar's Bold,
colour and size, or a saved style, change no text: they wait for what is typed next
(`typing.marks`). The toolbar shows that look as the caret's all the same, and a style saved
from it shows as the selected one, so a quote, heading or list chosen then looked as if it
dropped the style.

- **A block or a list chosen at a caret with a look waiting gives the line that look**
  (`withWaitingLook` and `lookOnBlock` in `reduce.ts`, from `setBlock` and `setList`): the
  change of block is made, then each waiting property is set on the whole block the caret is
  in, as it would be on a selection. Nothing is left waiting then: what is typed next takes
  the look of the text before it, which now has it. A property that cannot be set there is a
  skipped part with its reason. A block that is only a picture takes no look.
- **A click into another block that has text clears a waiting look** (`keepsTyping` in
  `field.ts`; 7.4.3 kept it for every plain click). The look was not chosen for that text
  (Enter may have carried it there), the toolbar would show it as that text's, and a block
  chosen there would give it to the line. A click in the same block, or on an empty line,
  keeps it as before.
- It is so for Normal text, the headings, Quote and the three lists, into them and out of
  them. A code block takes no style: its text stays plain and nothing is left waiting.
- On an empty line nothing changes: the block and the look both wait for the first letter.
- A look that moving the caret with the keyboard has cleared (7.4.3) is not waiting, and the
  toolbar does not show it: a block chosen then is plain, as before.

## The toolbar on an empty line (2026-11-13)

Found on the server, in a real note: on an empty line the toolbar showed the font, size, Bold
and saved style of the text above it, because the caret's look was that of the last
character before it anywhere in the note (`caretChar`, version 1's `selectionState`). What is
typed on an empty line does not take that look, so a quote chosen there with "the style
selected" was plain.

- **The caret shows the look of a character of its own block only** (`caretChar` in
  `reduce.ts`; `describe` and `shownSize` use it). On an empty line there is none: the
  toolbar shows plain text at the note's size, and the Styles button no style, unless a look
  is waiting there (one chosen on that line, or carried by Enter).
- **A block's shortcut typed in a look keeps the look.** `> ` typed with a saved style
  waiting made a plain quote, the marks having taken the look with them. The look of the
  marks goes on waiting for the text typed in the block (`shortcut` in `reduce.ts`).

