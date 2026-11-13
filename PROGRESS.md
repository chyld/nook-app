# Progress (version 2 build)

The app was built in `v2/` and moved to the top level of this folder on 2026-11-12 (alpha's change 1);
the paths below are relative to that folder, and `v2/` in the older entries means it.

Build order of SPEC2 section 14. Commands are in README.md (written at the end).

- [x] Workspace `v2/` with npm workspaces; dependencies of SPEC2 section 3 installed.
- [x] 1. `contract`: patterns, limits, shapes, routes (`packages/contract/src/index.ts`). tsc clean.
- [x] 2. `core` (`npm run test:core`: 66 tests)
  - [x] Ported version 1's routines (`packages/core/src/style/`, `fmwriter.ts`, `text.ts`,
        `frontmatter.ts`) and tests (`packages/core/test/`). Size step changed to 1 pt. 45 pass.
  - [x] `load`, `serialize`, `noteTitle`, `cleanTitle`, `cleanTag` (`meta.ts`)
  - [x] `reduce` (`reduce.ts`), region rule (`region.ts`), `describe`, `describeCell`
        (`describe.ts`), scenario runner (`test/scenario.ts`), scenarios (`test/scenarios.test.ts`)
  - [x] Rules of 7.2 moved in (styleToCarry, block/list/useStyle adapters, cell styles)
  - [x] Properties (fast-check, 4000 runs) and bytes tests (`test/properties.test.ts`)
- [x] 3. `server` (`npm run test:server`: 36 tests): storage (`space.ts`, `layout.ts`), notes,
      history, trash, save as new, accounts and sessions, photos, fonts, styles, admin command
      and socket, backup pause. Crash-at-each-step tests (`test/storage.test.ts`).
- [x] 4. `web` (`npm run test:web`: 24 tests; `npm run typecheck`, `npm run lint:css` clean):
      tokens and primitives, stores, router, every screen, the editor (CodeMirror: field,
      decorations, dispatchIntent, filter, caret stops, composition, tables, widgets), toolbar
      from the command table, `window.__notes`.
- [x] 5. `e2e` (7 journeys: `npm run test:e2e`), Docker (`Dockerfile`, `compose.yaml`,
      `Caddyfile`, `scripts/backup.sh`, `scripts/restore.sh`), README.

## Final run (2026-11-12)

typecheck (tsc + svelte-check) clean; lint:css clean; core 66/66; server 36/36; web 24/24;
e2e 7/7. `docker compose -p notesv2 up -d --build` healthy on https://localhost;
`node e2e/docker-smoke.ts` passed with an account made by `notes-admin add-user` (log in,
create, type, bold in Rich, save, reload); that throwaway account was then removed. The stack is
left running.

## Not done or not tested

- The backup scripts are adapted from version 1's but were not run against a restic repository.
- Fonts were tested against a fake Google server only; the live catalogue was not fetched.
- Composition is tested through Chromium's IME simulation (CDP), not on a real phone.

## Acceptance fix (2026-11-12)

Table cell text left unsaved when a cell was left other than by Tab or Enter (SPEC2 7.7): fixed
in `web/src/editor/table.ts` (`CellFocus`, `flushActiveCell`), tests in `web/test/cells.test.ts`
and `e2e/cells.test.ts`; `e2e/docker-smoke.ts` also checks a cell saved with Save. See the last
section of SPEC-NOTES.md.

## Code review fixes (2026-11-12, brief `brief-v2-fixes.md`, now in `archive/v2/`)

Working through `CODE-REVIEW-V2-FINDINGS.md` in order; outcomes are in `FIXES.md`. The
sources and bundle as they were before these fixes were copied out of the `notesv2-app` image
(to see each new test fail on them; not kept in `v2/`).

- [x] Section 1 (lost text): 1-9c. New tests: `web/test/lost-text.test.ts`, e2e
      `cells.test.ts` (7 new cases), e2e `review.test.ts`. Alpha chose B for finding 5 (ask first).
- [x] Section 2 (security): 10-16. New tests: `server/test/review.test.ts`, `web/test/fontcss.test.ts`.
      Caddy restarted with the new hardening (app container not rebuilt yet).
- [x] Section 3 (wrong results): 17-35d. New tests: `core/test/review.test.ts`, `web/test/review.test.ts`,
      `server/test/backup-script.test.ts`, more in `server/test/review.test.ts` and `e2e/review.test.ts`.
- [x] Section 4 (tests): 36-45. Found and fixed on the way: `setList` adapter (36), `typeOver` with markup
      at the selection's ends (38), undo/redo skipping caret stops (41).
- [x] Full run (2026-11-12): typecheck and lint clean; core 77/77, server 56/56, web 51/51,
      e2e 36/36. `docker compose -p notesv2 up -d --build` healthy; `node e2e/docker-smoke.ts`
      passed against https://localhost with a throwaway account, removed afterwards.
      README counts updated. Report sent to alpha.

## Review of alpha's changes (2026-11-12, brief `brief-change-fixes.md`)

Working through `CHANGES-REVIEW-FINDINGS.md` in order; outcomes go in `FIXES.md`, section
"Review of alpha's changes". The code as alpha left it was copied to the scratchpad before any
fix (to see each new test fail on it; not kept here). New tests: `core/test/changes.test.ts`,
`web/test/changes.test.ts`, `e2e/changes.test.ts`.

- [x] Section 1 (lost or damaged text): 1-7. The no-break space rule is in `core/src/style/blank.ts`
      and SPEC-NOTES.md ("The kept space"). The click under a final table is the intent
      `lineAfterTable`. Done ahead: 9 (blank lines after the front matter) and the copy half of 14.
- [x] Section 2 (things that break): 8-16. Invisibles rebuilt on MatchDecorator plus a line-end
      builder that takes each line once (`Invisibles`, `lineEnds`); handles take no clicks
      unless shown, inside the photo on touch; the new table's cell is entered in the same task
      (`enterNewTable`); fonts loader fixed and stops on a page that adds nothing; search folds
      U+00A0; an IME composing with a size waiting draws it (`composingStyle`). The last line's
      missing pilcrow (part of 15) is not a fault: it has no line end.
- [x] Section 3 (looks and access): 17-22. Toolbar colours are new `--group-N` tokens (7, one per
      group, 4.5:1 in light and dark); the invisibles button has its own; fonts search row fits at
      280 px; the corner photo handle is the keyboard slider; table text at the note's size; font
      names escaped with `cssString` everywhere. Part of 21 (the button's label) is not a fault.
- [x] Section 4 (the rules of the spec): 23 (done with 1), 24 and 25 recorded in SPEC-NOTES.md
      ("Alpha's changes after the build"), 26: README's backup path and PROGRESS's paths fixed
      (counts at the end).
- [x] Section 5 (tests): 27 (exact endings in e2e `cells.test.ts`) and 28 (the named tests, one for
      each change 7-15; the property test now generates `spacing` and `lineAfterTable`, and found
      a non-idempotent Bold, fixed in `setMark`).
- [x] Full run (2026-11-12): typecheck and lint clean; core 88/88, server 57/57, web 60/60,
      e2e 58/58. `docker compose up -d --build` healthy at https://localhost; `node
      e2e/docker-smoke.ts` passed with a throwaway account, removed afterwards (its empty folder is
      in `removed/`, as `remove-user` does). README counts updated.

## Drawings (2026-11-12, `SPEC-DRAWINGS.md` draft 5, branch `drawings`)

Build order of SPEC-DRAWINGS section 9; one commit per step. What departs from the spec is in
SPEC-NOTES.md, "Notes on SPEC-DRAWINGS.md".

- [x] 1. The first step of section 2: Excalidraw 0.18.1 mounted from the production build under
      the policy of 3.2 (drawing, text, an image, fonts from Nook, the library, an embedded page,
      Mermaid). The policy blocked nothing; no Vite `define`; opening a scene changes no
      element's version. `react`, `react-dom` 19.3.1 and `@excalidraw/excalidraw` 0.18.1 added
      as exact versions.
- [x] 2. `contract`: `kind` in entries, `Kind`, `DRAWING_TYPE`, the body kinds `document` and
      `json-or-document`, `LIMITS.drawingBytes` (25 MB) and `drawingHistory` (20), the pages
      `/d/:id` and `/d/:id/history`.
- [x] 3. `core`: `drawing.ts` (`serializeDrawing`, `emptyDrawing`, `drawingFacts`, the checks of
      a save, the signature of 4.3, `sceneOf`) and `core/test/drawing.test.ts` (11).
- [x] 4. `server`: `layout.ts` and `space.ts` by kind, the body pipeline for the drawing type,
      415 for the wrong kind, the policy in `app.ts`; `server/test/drawings.test.ts` (17).
- [x] 5. `web`: the store, client and drafts by kind; `/d/<id>` and `/d/<id>/history`;
      `drawing/mount.ts` and `DrawingScreen.svelte`; the library in local storage; the sidebar's
      New drawing and drawing rows; `DrawingHistory.svelte`; trash rows by kind;
      `web/test/drawings.test.ts` (12).
- [x] 6. `e2e/drawings.test.ts` (12), README.md, SPEC-NOTES.md, this file, and the changes to
      SPEC2.md (marked "(SPEC-DRAWINGS)").
- [x] Full run (2026-11-12): typecheck and lint clean; core 99/99, server 74/74, web 74/74,
      e2e 70/70. No Docker command was run: the running stack has not been rebuilt with drawings.
- [x] Code review of drawings (2026-11-12, twelve reviews in `../codereview/`; outcomes in
      `../codereview/RESPONSE.md`, behaviour changes in SPEC-NOTES.md). Each fix has a test
      that failed first where one could be written: web store (9 new), server (1), e2e (8 new,
      and "a change followed at once by leaving asks first" rewritten so that it fails without
      `flush()`). Full run: typecheck and lint clean; core 99/99, server 75/75, web 83/83,
      e2e 78/78.
