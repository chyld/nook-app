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
