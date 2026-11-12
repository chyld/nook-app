# noteformat

A TypeScript library that reads a note in the format of `../SPEC.md` (version 1.2) and renders it
as HTML. `SPEC.md` is the authority; where it is ambiguous, `SPEC-ISSUES.md` lists the point, a
concrete input, and what was implemented.

## Running

Node 26 runs the TypeScript directly (type stripping); there is no build step.

```sh
npm install              # markdown-it, and typescript + @types/node for type checking
npm test                 # node --test, every file in test/
npx tsc --noEmit         # type check
node src/cli.ts FILE.md            # print the HTML fragment
node src/cli.ts FILE.md --page     # print a complete page that links theme/paper.css
```

CLI options: `--css HREF` sets the stylesheet link of `--page` (default: the path of
`theme/<theme>.css` relative to the note's folder); `--root DIR` is the notes folder for the image
check (default: the note's folder); `--allow-remote-images` loads remote images. The CLI checks
local images against the file system (SPEC 6: resolved against the note's folder, symbolic links
followed, the file must exist inside the notes folder), passes the file's modification time as
the default `updated`, and refuses a file that is not valid UTF-8 (SPEC 2).

`examples/lisbon-trip.md` is the section 9 example exactly; `examples/lisbon-trip.html` is
`node src/cli.ts examples/lisbon-trip.md --page`. Its photos do not exist, so the page shows the
image placeholders.

## API

```ts
import { parseNote, renderNote } from "./src/index.ts";

parseNote(source: string): Note
renderNote(source: string, options?: RenderOptions): { html: string; meta: NoteMeta }
```

`RenderOptions`: `fileName` (title fallback), `allowRemoteImages` (default false),
`isLocalImageAllowed(decodedPath)` (default: a relative path that does not start with `/` and does
not leave its folder through `..`), and `modifiedTime` (default of `updated`; an addition to the
brief's options). `meta` holds `title`, `tags`, `created`, `updated`, `font`, `size`, `theme`
with the defaults of SPEC 3 applied. `noteBodyStyle(meta)` gives the inline style (front matter
`font` and `size`) for the element that holds the fragment; the CLI puts it on
`<article class="note">`.

Version 1.1 (SPEC 1.1, for the web app of `../DESIGN.md`):

- **`id`.** Front matter `id` is read and validated (exactly 12 characters from `a-z` and
  `2-7`) and returned in `frontMatter.fields.id` and `meta.id`. An invalid value is ignored and
  kept in `frontMatter.mapping`, like any invalid value. `isValidId(v)` is exported.
- **Image destination ranges.** Every `Image` node has `destinationRange`: where its destination
  is written in the source, angle brackets included (`<My note.assets/x.jpg>`), empty for
  `![a]()`. For a reference image (`![a][ref]`, `![ref][]`, `![ref]`) it is the destination in
  the link reference definition the image uses (the first definition of the label), and
  `image.label` is that definition's normalised label, so images sharing a definition share
  one range. Every `LinkDefinition` also has its own `destinationRange`. The app's photo path
  routine (DESIGN 5.6) rewrites exactly these ranges. Tests: `test/v11.test.ts`.

Version 1.2 (SPEC 1.2, for the editor of `../EDITOR-PLAN.md`):

- **Points.** A size value may be a number from 1 to 400 with at most one decimal followed by
  `pt` (`14pt`, `10.5pt`), written to CSS as it is. `012pt`, `14.pt`, `14.25pt`, `0.5pt` and
  `12PT` are not size values. `absoluteSizePt(v)` gives a pixel or point value in points (1px is
  0.75pt).
- **Theme sizes.** `theme/paper.css` makes normal text 12pt and headings 1 to 6 2, 1.5, 1.1667,
  1, 0.9167 and 0.8333 times the note's size (24, 18, 14, 12, 11 and 10 points in a note of the
  normal size). `BODY_PT` and `HEADING_FACTORS` give the same numbers to code.
- **`styleRuns(note | source)`** (`src/runs.ts`) lists the visible characters in order: each
  character of text, a soft break (`" "`), a hard break (`"\n"`) and an image (U+FFFC, one
  unit), with its effective style by the rules of SPEC 5.5 (bold, italic, strikethrough, code,
  underline, colour, background, font, size in points, link destination), its block, and its
  source range (an escape or entity reference is one character spanning its whole source).
  `blocks` gives each block's kind, container path (quote, list, item, task state, table cell),
  size, block attribute line and whether it may carry a block attribute line. The editor's
  checks compare these (`styleKey`). Tests: `test/runs.test.ts`.

`Note` is the syntax tree of `src/types.ts`: front matter (the parsed YAML mapping, every key kept,
and the valid known fields), blocks, inline nodes and link reference definitions. Every node has
`range: { start, end }`, offsets into the source string exactly as given (byte order mark and
CRLF included). Paragraphs and headings also have `contentRange`; block attribute lines,
attribute lists, single attributes and task markers have their own ranges. A heading's range is
its own line; its block attribute line is in `heading.attributes.range`.

## Structure, mapped to the parse order of SPEC 5

| Step | File | What it does |
|---|---|---|
| SPEC 2 | `src/source.ts` | Line splitting (LF, CRLF), the body text with LF line endings and NUL replaced, and the map from body positions back to source offsets. |
| 1. Front matter (SPEC 3) | `src/frontmatter.ts` | The three conditions, the closing line, the known keys and their validation. |
| | `src/yaml.ts` | The YAML reader for condition 3 (see Known gaps for the subset). |
| 2. Blocks | `src/blocks.ts` | Runs markdown-it's block parser (CommonMark preset, HTML off), hooks every block rule to record the source position of each line, and converts the tokens to the tree. Replaces markdown-it's table rule with a GFM table rule that decides a table's structure with the same row splitter that cuts its cells (each cell is a block of its own for inline parsing), and takes task list markers here, as step 2 requires. |
| 3. Block attribute lines (SPEC 5.4) | `src/blockattrs.ts` | Conditions 1 to 5 on every paragraph that is a direct child of the document; attaches the line to the heading, paragraph or image and removes it from the text. |
| 4.1 Scan pass (SPEC 5.1) | `src/inline/scan.ts` | The left-to-right scan with the bracket stack: code spans, autolinks, styled spans (test 1), links and images (test 2), literal brackets (test 3). |
| | `src/inline/commonmark.ts` | The CommonMark pieces the scan uses: code span, autolink, link destination, title and label. |
| | `src/attributes.ts` | SPEC 5.3: the attribute list syntax, and validation of each key and value. |
| 4.2 Mark pass (SPEC 5.2) | `src/inline/marks.ts` | Delimiter runs of exactly two `+` or `=`, the open and close tests, pairing per scope, and the content of a mark as a new scope. |
| 4.3 Bare URL pass | `src/inline/bareurls.ts` | GFM extended autolinks in the literal text left by the first two passes, in every scope except link text. |
| 4.4 Emphasis pass | `src/inline/emphasis.ts` | CommonMark's "process emphasis" algorithm and GFM strikethrough, in each scope. |
| | `src/inline/items.ts` | The working representation the passes share: a scope is a list of literal text runs and recognised constructs. |
| | `src/inline/index.ts` | Runs the four passes in order and builds the public inline nodes (escapes, entities, line breaks). |
| Orchestration | `src/parse.ts` | `parseNote`: steps 1 to 4 in order. |
| Rendering | `src/render.ts`, `src/style.ts`, `src/images.ts` | HTML for the tree; CSS values for attributes; SPEC 6 image classification, decoding and checks. |
| API, CLI | `src/index.ts`, `src/cli.ts` | `parseNote`, `renderNote`, `NoteMeta`; the command line and `--page`. |
| Other | `src/chars.ts`, `src/entities.ts` | Character classes of SPEC 2 and CommonMark; entity references and backslash escapes. |
| Theme | `theme/paper.css` | The stylesheet of `--page`: every `--note-*` variable for light and dark, typography, tables, code, quotes, images, placeholder, `<mark>`, `<u>`. |

## Dependency choice

**markdown-it** (15.0.3) does step 2, the CommonMark block structure, and nothing else: its
inline parser is never run, and its table rule is replaced by this library's GFM table rule, so
that a table's structure and its cells come from one row splitter. Writing a CommonMark block parser (lists, lazy continuation,
tabs, fences, link reference definitions, setext headings, tables) is where most of CommonMark's
difficulty lies, and markdown-it's block rules are mature and tested against the CommonMark spec.
It also has the properties step 2 needs: HTML blocks can be switched off, reference definitions
are parsed at block level, and its rules can be wrapped, which is how this library records the
exact source position of every line of every block. The price is that its token stream has no
character offsets, so `src/blocks.ts` wraps each block rule (and the list item token) to keep
them, and recomputes the inline text of paragraphs, headings and table cells from those
positions. Everything in SPEC 5 (spans, marks, bare URLs, emphasis, attribute lists, block
attribute lines) is this library's own code. markdown-it is also used for two small utilities:
CommonMark label normalisation and the HTML5 named-entity table.

## HTML output

The fragment follows the brief's HTML contract: commonmark.js-style block output (`<p>…</p>\n`),
HTML5 void tags (`<hr>`, `<br>`, `<img …>`, `<input type="checkbox" disabled>`), text escaped
(`& < > "`), `<span style="…">` with declarations in the order color, bg, font, size, underline,
`<u>` and `<mark>` for the marks, `style="text-align: …"` on aligned table cells, and the image
placeholder `<span class="note-image-placeholder" data-src="…">alt</span>`. A hex colour is
written exactly as in the note, case included (SPEC 5.3), so `{color=#ABCDEF}` gives
`color: #ABCDEF`. A bare URL's text and destination are the note's text as written: entity
references in it are not decoded, so `https://example.com/a&#65;b` links to exactly that.

### Nesting limit

No input makes `parseNote` or `renderNote` throw or run for long; a 1 MB note renders in well
under a second. Inline constructs nest at most **32** deep (`MAX_NESTING` in
`src/inline/items.ts`):

- the scan pass does not recognise a styled span, link or image whose content already holds 32
  levels of spans, links and images; both its brackets stay literal text;
- the emphasis pass does not form emphasis, strong emphasis or strikethrough whose content already
  holds 32 levels of them; its delimiters stay literal text;
- marks need no limit: by the pairing rule of SPEC 5.2 they never nest more than two deep;
- as a last guard, an inline construct more than **128** levels below its block
  (`MAX_TREE_DEPTH`, reachable only by mixing the kinds above) is kept as its literal source text.

Front matter YAML nests at most **64** collections deep (`MAX_YAML_DEPTH` in `src/yaml.ts`); deeper
front matter is treated as invalid YAML, so the file has no front matter. Block nesting is
markdown-it's own limit.

### How SPEC 5.5 holds in the rendered HTML

- **Font, colour, size**: CSS inheritance gives the order front matter (on the body element),
  block attribute line (on `<p>`/`<hN>`), span. Where the theme styles an element itself, the
  theme gives way: links take the colour of a coloured ancestor (`[style^="color:"] a { color:
  inherit }`; `color` is always the first declaration written), `<mark>` keeps the surrounding
  colour, headings inherit the note's font, and code takes the font of a span or block that sets
  one (but not the front matter font, SPEC 3). Inline code and the image placeholder set no
  colour of their own, and inside a span, paragraph, heading or `==` mark that sets a background
  they give up their own background; the placeholder also takes the font of a span or block that
  sets one. A named size on a heading's block attribute line multiplies the heading's own size:
  `font-size: calc(var(--note-h2-size, 1.5em) * 1.25)`; on a paragraph or span `1.25em` is already
  right.
- **Background**: a span's `bg` is stronger than a `==` mark in both nestings. `==[x]{bg=red}==`
  works by painting order. For `[==x==]{bg=red}` the mark inside a span with a valid `bg` is
  written `<mark style="background-color: var(--note-red)">`, so it shows the span's colour.
- **Underline**: CSS cannot remove an underline that an ancestor paints. When a block attribute
  line sets `underline=yes` and the block contains a span with `underline=no` (not inside a `++`
  mark), the block element does not get `text-decoration: underline`; instead each run of its
  content outside such spans is wrapped in `<span style="text-decoration: underline">`, going
  inside `<strong>`, `<em>`, `<del>`, `<a>` and `<mark>` where needed. Its other declarations stay
  on the block element. In every other case the block element carries `text-decoration:
  underline` as the contract says. A `++` mark is `<u>`, whose underline no descendant can cancel,
  so `underline=no` has no effect inside it. Links are not underlined by the theme (rule 4).

### Rendering decisions the spec leaves open

- Links whose destination starts with `javascript:`, `vbscript:`, `file:` or `data:` are written
  as `<a>` without `href`. Other destinations are percent-encoded as the CommonMark reference
  renderers do.
- A local image is shown only if its path ends in a supported type's extension (SPEC 6; see
  SPEC-ISSUES 4) and `isLocalImageAllowed` accepts the decoded path. Besides absolute paths and
  `..`, the default check refuses absolute paths of other systems: a drive path (`C:/…`, `C:\…`,
  and `C:…`, which Windows reads relative to a drive), a path starting with a backslash
  (`\\server\share\…`), and `..` written with backslashes. Its `src` is the decoded path
  percent-encoded segment by segment, so a space is `%20` and a colon cannot start a URL scheme.

## Tests

`npm test` runs every `test/*.test.ts`. Tests are named after the section they check:
`span.test.ts` (5.1: scan pass rules, every Consequence, Content and Example),
`marks.test.ts` (5.2), `attributes.test.ts` (5.3), `blockattrs.test.ts` (5.4),
`precedence.test.ts` (5.5), `escaping.test.ts` (5.6), `parse-order.test.ts` (the parse order,
the bare URL pass, scopes and flanking of section 5), `frontmatter.test.ts` (3), `images.test.ts`
(6), `example.test.ts` (9, and the example files), `source.test.ts` (2 and source ranges),
`v11.test.ts` (the `id` key and image destination ranges of SPEC 1.1), `runs.test.ts` (points, theme sizes and `styleRuns`), `base.test.ts` (CommonMark and GFM, including a differential check of 134 pure-CommonMark inputs
against markdown-it's own CommonMark renderer), `spec-issues.test.ts` (one test per
open SPEC-ISSUES point, and the points SPEC 1.0.1 settled), `limits.test.ts` (deep nesting and
1 MB notes), `yaml.test.ts` and `cli.test.ts`.

## Known gaps

- **YAML is a subset.** `src/yaml.ts` reads block and flow mappings and sequences, plain, quoted
  and block scalars, comments, anchors, aliases and tags. It reports an error for explicit `?`
  keys, collections or aliases used as keys, directives (`%YAML`), and `...` document markers, so
  front matter using them is not front matter. Nesting deeper than 64 is also an error (see
  "Nesting limit"). It is not a validating YAML 1.2 parser: it may
  accept some documents a strict parser rejects (for example an implicit key longer than 1024
  characters, or unusual indentation of a multi-line quoted or flow scalar).
- **The CommonMark 0.31.2 spec suite is not run.** Block structure is markdown-it's (except GFM
  tables, see above); the base is
  checked by hand-written tests and by the differential test against markdown-it's CommonMark
  renderer, not by the 652 spec examples (they were not available offline). Any block-level
  difference between markdown-it 15.0.3 and CommonMark 0.31.2 is inherited.
- **An unavailable font does not fall back to the surrounding font.** SPEC 5.3 says the text then
  keeps the font it would have had; the HTML contract writes `font-family: 'Caveat'` with no
  fallback list, so a browser that lacks the font uses its default font instead.
- **Image type is decided by file extension** for local images; content is not sniffed, and remote
  images are not type-checked.
- **The library's default image check is not a file-system check.** It does not follow symbolic
  links or check that the file exists; the app supplies that check (the CLI does, see above).
- **`updated` defaults to the file's modification time only when the caller passes
  `modifiedTime`**; the library reads no files. Likewise only the CLI checks that a file is valid
  UTF-8: the library receives a string.
- **Only one theme exists.** `meta.theme` is returned as written; the CLI uses `paper` for every
  name, as SPEC 3 asks for an unknown name.
- **Inline nesting is limited** to the depths given in "Nesting limit"; deeper constructs are
  literal text, which no ordinary note reaches.
- **App behaviour is not implemented**: saving (keeping the byte order mark, line endings, unknown
  front matter keys), renaming a note with its `.assets` folder, asking the person before loading
  remote images, and showing alt text as a caption. Section 7 and section 10 are out of scope.
