// The editing core (SPEC2 section 7): pure TypeScript, no DOM, no Node APIs. `server` and `web`
// import it from here.

export * from "./types.ts";
export { reduce, checkRegion, addMark, changesOf, styleToCarry, shownSize, listAt, tableAt, mapPos, REFUSE_SELECT } from "./reduce.ts";
export { describe, describeCell, COMMANDS, type CommandId } from "./describe.ts";
export { noteTitle, cleanTitle, cleanTag, isCleanTag, load, serialize, noteSizeOf, noteFontOf, naturalSize, TITLE_MAX, TAG_MAX, type Eol } from "./meta.ts";
export { normalizeIntent } from "./normalize.ts";
export { diff, regionOf, extents, tablesOf, bodyStart, finalTable } from "./region.ts";
export { isBlank, isMdSpace, plainSpaces } from "./style/blank.ts";
export { hasBrokenFrontMatter } from "./frontmatter.ts";
export { noteSpacing, readSettings, validSpacing, writeSetting } from "./fmwriter.ts";
export { buildModel, type BlockModel, type INode } from "./style/model.ts";
export { stepSize, ptValue, selectedChars, MIN_SIZE, MAX_SIZE } from "./style/apply.ts";
export { copySelection } from "./style/typing.ts";
export { linkAt, tasks } from "./style/widgets.ts";
export { parseTable, writeTable, type Grid } from "./style/tables.ts";
export { cellBaseSize, cellMarkdown, cellChars, shownLength, PLAIN, type CellStyle } from "./style/cells.ts";
export { lineEndings, toLf, utf8Length, decodeUtf8, encodeUtf8, hasBom, BOM } from "./text.ts";
export { appendToNote, droppedImage, firstLineEnding, hasFrontMatter, liveElements, newNoteText, noteIsBlank, splitNote, withFrontMatter, withNook, yamlQuote } from "./agentdoc.ts";
export { serializeDrawing, emptyDrawing, sceneOf, drawingFacts, drawingProblem, drawingSignature, drawingText, keptAppState, nookOf, parseDrawing, usedFileIds, KEPT_APP_STATE, type DrawingFacts, type DrawingNook, type DrawingProblem, type DrawingScene } from "./drawing.ts";
