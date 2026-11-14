# Nook: normal text only

**Status: agreed by the owner, 2026-11-13.** The three questions of section 9 were answered:
old blocks are left as they are (option A); lists, tables, the horizontal line and photos stay;
Raw mode and agents may still write the three blocks.

Written by alpha from the research of three beta agents (opus: the editing core; sonnet:
existing notes, Raw mode, paste and agents; haiku: the screen, the tests and the documents).
Where they disagreed, section 4 says so.

## 1. The decision

The owner's words: "This thing is way too buggy. Let's remove features to make this thing
simpler. We're going to have just normal text. No headings, no quotes, no code blocks.
Everything else is just inline stuff."

Most of the bugs fixed on 2026-11-13 were a saved style, or a look waiting at the caret,
meeting one of these three blocks (SPEC-NOTES.md, the last five sections). With no way to make
such a block, those paths cannot be reached from the editor.

## 2. What goes

A person can no longer make a heading, a quote or a code block in the editor.

| Where | What is removed |
|---|---|
| Toolbar | The Block style menu (Normal text, Heading 1 to 6, Quote, Code block). The List and Insert menus stay beside each other. |
| Typing | The line-start shortcuts `# ` to `#### `, `> ` and three backticks. Typed in Rich mode they are those characters, as text. |
| Core | The `setBlock` intent, the block kinds other than a paragraph, `typing.block` (a block waiting on an empty line), and the "block" field of the toolbar's state. |
| Paste | Text pasted in Rich mode never makes one of the three: Markdown that holds one is pasted as plain lines. |
| Agent guide | The rows for Heading, Quote and Code block, and the example note's headings, quote and code block. |
| Drawing | Covered by section 4: what an existing block looks like. |

## 3. What stays

- **Inline code** (the `<>` button and `` `text` ``). Only the code *block* goes. This document
  always says "code block" or "inline code", never just "code".
- Bold, italic, underline, strikethrough, colour, highlight, font, size, links, saved styles.
- Lists (bullets, numbers, tasks) and their shortcuts `- `, `* `, `1. `, `[] `.
- Tables, photos, the horizontal line, Raw mode, History, search, drawings.
- **The note format and its reader (`noteformat/`) are not changed.** A `# ` line in a file is
  still a heading as far as the format goes; Nook stops making them.
- A note's title: the front matter's `title`, else the first level-1 heading, else `Untitled`,
  as today, so no existing note changes its name.

## 4. Notes that already have a heading, a quote or a code block

**This is the one real decision.** Such text exists already and can still arrive: an old note,
a version restored from History, something typed in Raw mode, a note an agent wrote.

| | Option A: leave them as they are | Option C: turn them into normal text |
|---|---|---|
| What you see | An old heading still looks like a heading. You cannot make a new one. | Opening a note in Rich mode turns its headings, quotes and code blocks into ordinary lines, once, with a message. |
| Files on disk | Never rewritten by this change. | Rewritten when converted (the old text goes to History as any save does). |
| Bugs | Gone for anything you write from now on. Still possible when editing an old heading, quote or code block. | Gone everywhere; the block code can be deleted. |
| Size of the work | Small: remove the ways in. About 150 lines of the core, the menu, 10 tests deleted and a few dozen rewritten. | Larger: a converter, every place text enters the editor, a rule for each kind of block, more tests. |
| Risk | Low. | A conversion that loses or merges text: a heading joined to the line under it, a quote holding a list or a table, code with backticks in it. |
| Recommended by | opus, haiku | sonnet |

**Recommendation: A now, C later if old blocks still get in the way.** A removes the features
from the app as asked, touches no file, and is small enough to review properly. Under A:

- An existing heading, quote or code block is drawn as today and can be edited as today.
- **Backspace at the start of a heading or a quote makes it normal text** (it does today).
  That is the way to get rid of one. A code block is left by Enter on its empty last line.
- A saved style or a look applies to an old heading as it does now.

If C is chosen instead, it needs its own rules (one converter in the core, used wherever text
meets the Rich editor; a heading's text kept as a paragraph; `>` marks removed; each code line
kept as inline code; the title written into the front matter when it came from a heading), and
a backup before any note is touched.

## 5. Rules that hold under either option

1. **Rich mode cannot make one.** No control, key, shortcut or paste produces a heading, a
   quote or a code block. Every character typed or pasted in Rich mode leaves the number and
   kinds of blocks as they were, apart from lists, tables and horizontal lines made by their
   own commands. This is a generated test, not only examples.
2. **Typed marks are text.** `# x`, `> x`, three backticks, and a line of `===` or `---` under
   text (the format's other heading) stay as typed and are shown as typed.
3. **Raw mode is the file as written.** A person can type `# x` there; the Preview tab and
   History's rendered view show what the format says. This is stated so that nobody "fixes" it.
4. **Agents** may still send any Markdown; nothing is refused (an agent that read an old note
   and saved it back must not be locked out). The guide stops teaching the three blocks and
   says to write plain paragraphs and lists.
5. **Nothing is rewritten on open or save because of this change** (option A), tested on a
   file with a heading, a quote and a code block, byte for byte.

## 6. What changes in the code

- `packages/web`: `lib/commands.ts` (`BLOCKS`, the `block` command), `screens/Toolbar.svelte`
  (the menu and its label), the keymap if it names a block. The toolbar is checked at phone
  width, since a group gets narrower.
- `packages/core`: `types.ts` and `normalize.ts` (`setBlock`, `BlockKind`, `Typing.block`),
  `reduce.ts` (`setBlock`, `changeBlock`, `writeStart`, the first-letter block in
  `insertText`, the block field in `describe`), `style/typing.ts` (`lineShortcut` keeps the
  list shortcuts only; pasted Markdown), `describe.ts`.
- **Kept, because lists use them too:** `keepingStyle`, `withWaitingLook`, `lookOnBlock`,
  `result`, `seen`, `touchedBlocks`, `toggleList`. Under option A the rules for editing inside
  an existing heading, quote or code block (Enter, Backspace, joining, `leaveCode`) are kept
  as well, and named in SPEC-NOTES as "kept for existing notes".
- TypeScript must be clean, not only the tests: removing `setBlock` from the intent type makes
  the compiler point at every caller.
- Afterwards a search for `cmd-block`, `setBlock`, `BLOCKS` and `typing.block` finds only what
  this document names.

## 7. Tests and documents

- **Deleted:** the tests whose only subject is making one of the three blocks (10 named by
  haiku; most of `packages/core/test/style-heading.test.ts`).
- **Rewritten onto paragraphs and lists, not deleted:** tests that use a heading or a quote in
  passing while testing styles, lists, carets or Enter. Deleting them would lose that cover.
- **Added:** no Block menu on the toolbar; `# x`, `> x` and a fence typed in Rich stay text;
  the three pasted in Rich stay text; rule 5.1 as a generated test; rule 5.5.
- The test generators stop sending `setBlock` and the removed shortcuts, and keep starting
  texts that contain the three blocks (old notes still have them under option A).
- README, SPEC2 (9.4 and the tables of 7.5 and 7.6), the agent guide with its example, and a
  dated entry in SPEC-NOTES change in the same commit as the code.

## 8. Done when

1. The toolbar has no Block menu; List and Insert work as before.
2. In a new note, nothing a person can do in Rich mode produces `#`, `>` or a fence at the
   start of a line as anything but text.
3. Every style, list, table and photo test that passed before still passes (rewritten where
   it leaned on a removed block).
4. Typecheck, lint, and the core, server, web and browser tests pass.
5. Beta agents have reviewed the diff and tried the build in a browser, as for today's fixes.

## 9. For the owner to decide

1. **Old headings, quotes and code blocks: leave them (A) or convert them (C)?** Recommended: A.
2. **Lists, tables, the horizontal line and photos stay?** The request named only headings,
   quotes and code blocks, so this document keeps them. Say so if any should go too.
3. **Raw mode and agents may still write `# x`?** Recommended: yes (rules 5.3 and 5.4); the
   alternative is refusing or rewriting what they send.
