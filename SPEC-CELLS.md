# Nook: a saved style in a table cell

**Status: built 2026-11-13.** Written by alpha from what three beta agents found by trying the
app (opus: the code; sonnet: hands on; haiku: what happens around it). The owner asked for it
directly ("I want to create a style and then use different styles inside of different cells")
and said to go ahead, so the choices below were made here and are listed in section 4.

## 1. What was wrong

- With the caret in a cell, or text selected in it, picking a saved style did nothing but show
  "This works on the note's text, not inside a table cell." The single controls (Bold, a
  colour, a size) worked there; a saved style, which is those same settings together, did not.
- After the size box was used in a cell, the next controls were lost: the box handed the focus
  to the note's text, so Italic or a font went to the note as a look waiting to be typed.
- A control used with only the caret in a cell left the whole cell selected, so the next
  letter typed replaced the cell's text.

## 2. What it does now

1. **A saved style picked in a cell is given to the cell's text.** With text selected in the
   cell, to that text. With only the caret there, to the whole cell, as the single controls do.
   Nothing outside that cell changes.
2. **A style sets; it does not toggle.** Each of its eight settings (font, size, bold, italic,
   underline, strikethrough, colour, highlight) takes the style's value, as it does on the
   note's text. Picked twice, it gives the same Markdown as once.
3. **A style that names no size** leaves the cell's text at the size cells have: a size the text
   had of its own goes, and no size is written.
4. **Default (reset)** in a cell clears the formatting of the selected text, or of the whole
   cell with only the caret there. A link stays a link.
5. **One change, one undo.** The whole style is one edit: Ctrl+Z takes all of it back. Text
   typed in the cell and not yet written goes in with it and is not lost.
6. **A setting the cell cannot hold is skipped and named**, and the others are applied, as on
   the note's text.
7. **In an empty cell the look waits for the text.** A saved style, or a single control (Bold,
   a colour, a size; Ctrl+B, Ctrl+I, Ctrl+U), picked in an empty cell changes nothing in the
   note yet. The toolbar shows it as the cell's, and the text typed there is drawn in it. It
   is written with the text, as one change, when the cell is written (left, Tab, Enter,
   Save): typing and undo in the cell are what they are in any cell. Until then picks add up
   as on an empty line of the note (a style replaces what waited; a single control joins it;
   Default (reset) clears it), and they are for all of the cell's text. Leaving the cell
   with nothing typed, or Escape, drops the look: it does not follow the caret to another
   cell, and it is not there when the caret comes back. In a cell edited as Markdown: the
   existing message.
8. **The focus stays in the cell** after any toolbar control, the size box included, so the
   next control lands in the same cell.
9. **With only the caret in a cell, a control leaves the caret where it was**, not the whole
   cell selected: what is typed next is added to the cell's text.

10. **Text typed in a cell is not lost by way of the toolbar.** A cell left for a field of the
    toolbar (the size box, a style's name) is not written yet; when another cell was then
    clicked, what had been typed was dropped, in any cell, styled or not. It is now written
    before the other cell is entered.

## 3. In the code

- `core`: text typed in a cell may carry `look`, the look that waited there (`PendingCell`,
  `setCell`); `tableEdit` gives it to that text as it is written (`withLook`), whichever
  operation writes it. `describeCell` lays a waiting look over the cell's state for the
  toolbar. `web`: the cell keeps the look (`waiting`), shows it as CSS on the cell while the
  person types (`lookCss`), and drops it when the cell is left empty.
- `core`: a table operation `applyStyleCell` (`types.ts`, `tableEdit` in `reduce.ts`). It takes
  the style's settings from `changesOf`, as `useStyle` does, and applies each through
  `styleInCell`, which sets. The cell's own base size stands in for a style with no size.
- `web`: the cell's handle gets `applyStyle` beside `style` (`editor/table.ts`); the toolbar's
  `send` passes a saved style to it (`screens/EditorScreen.svelte`); the size box does not take
  the focus out of a cell (`screens/Toolbar.svelte`); a caret is put back as a caret.
- Tests: the operation through `reduce` (sets, twice the same, no size, reset, part of a cell,
  the other cells unchanged, an empty cell); in the browser, two styles in two cells, one undo,
  the size box then another control, and typing after a control.

## 4. Choices made here

1. **Caret in a cell, nothing selected: the whole cell.** haiku recommended a look waiting for
   the next typing, as in a paragraph; opus the whole cell. The whole cell was chosen: it is
   what the single controls already do in a cell, "a style for this cell" is the request, and a
   cell has no waiting look to build on. The lost-text problem haiku raised is rule 9.
2. **An empty cell was first not styled ahead of typing** ("Type something in the cell
   first"). The owner tried exactly that (blank cell, pick a style, type) and asked for it, so
   rule 7 was built the same day. A first version wrote the look at the first letter typed;
   the beta agents showed that this left the look behind after Tab or Escape and disturbed
   undo, so the look is now kept on the cell and written with the text when the cell is.
3. **A style replaces every setting it holds,** bold off included, as on the note's text.
