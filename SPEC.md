# Note format specification

Version 1.2, 2026-11-10. Section 11 gives the history.

This document defines the file format of a note. It does not define the app, the editor or the
visual design. Rendering is mentioned only where the format depends on it.

## 1. Goals

1. One note is one plain text file. There is no database and no index that the format relies on.
2. The raw file looks like Markdown and is comfortable to read and edit by hand in any text
   editor.
3. The format covers ordinary Markdown plus underline, text colour, highlight, font family and
   font size.
4. Notes are rendered only by this app. Looking right in other Markdown viewers is not a goal.
5. The syntax is simple to parse and simple to edit programmatically. Styled spans do not nest.
6. A styling mistake never hides the text of a note.

## 2. The file

- A note is a UTF-8 text file with the extension `.md`. A file that is not valid UTF-8 is not a
  note: the app reports it and does not change it.
- A UTF-8 byte order mark at the start of the file is ignored when the note is parsed and kept
  when it is saved.
- Line endings are LF or CRLF. A lone CR also ends a line, as in CommonMark, and is kept as it
  is. A line ending is never part of a line's content, so a rule about
  what a line contains is the same for both. The app keeps every existing line ending as it is. A line the app
  inserts uses the line ending of the first line of the file, or LF if the file has one line.
  One exception: when a note mixes line endings, or has a lone CR, an editor may convert them
  all to a single kind when the person saves, after telling the person.
- The app does not normalise Unicode and does not re-wrap lines.
- A note's identity is its `id` (section 3). The file name without the extension is the note's
  name, and it may change. A file without an `id` is still a valid note; an app gives it one as
  described in section 3.
- The file has two parts: optional front matter (section 3), then the body (sections 4 to 6).

In this document, a **letter or digit** is a character in Unicode general category L or N, and
**whitespace** is Unicode whitespace as defined by CommonMark. Where the text says **ASCII
letter**, it means `a` to `z` and `A` to `Z` only.

## 3. Front matter

A file has front matter only if all three of these hold:

1. The first line of the file is `---`, optionally followed by spaces.
2. A later line is `---`, optionally followed by spaces. The first such line is the closing line.
3. The lines between them, parsed as YAML 1.2 with the Core schema, are a mapping with at least
   one key. A key that appears more than once in the mapping is allowed here, even though YAML
   itself forbids it, and its last occurrence is used.

If any of the three fails, the file has no front matter and the whole file is the body. A note
that begins with a horizontal rule is therefore read as body text, unless what follows the rule
happens to be a YAML mapping closed by another `---`.

| Key | Type | Meaning |
|---|---|---|
| `id` | scalar | The note's permanent identity: exactly 12 characters, each one of `a` to `z` or `2` to `7`. It does not change when the note is renamed. Any other value is invalid. Default: none. |
| `title` | scalar | Title shown for the note. Default: the text of the first level-1 heading, then the file name. |
| `tags` | list of scalars | Tags. |
| `created` | scalar | When the note was created: an ISO 8601 date in the extended form `YYYY-MM-DD`, optionally followed by `T`, a time (`hh:mm` or `hh:mm:ss`, with an optional fraction) and an optional zone (`Z` or an offset), such as `2026-11-10` or `2026-11-10T09:30:00Z`. Default: none. |
| `updated` | scalar | When the note was last changed, in the same form. Default: the file's modification time. |
| `font` | string | Default font family for the body text of this note: a font value as described in 5.3. Inline code and code blocks keep the theme's code font unless a span or block attribute line sets `font` on them. |
| `size` | string | Body font size of this note: a size value as described in 5.3 (pixels, points or a named size). A named size here multiplies the theme's body size. |
| `theme` | string | Name of the theme to render this note with. Themes are defined by the app. An unknown name means the app's default theme. |

- Every key is optional.
- The value of a scalar is its text as written in the file, without quotes. A number or boolean
  is not converted: `title: true` gives the title `true`, and the tag `1.50` is `1.50`.
- `font` and `size` are ordinary YAML strings. The quoting rules of 5.3 do not apply to them:
  `font: IBM Plex Serif` and `font: "IBM Plex Serif"` mean the same.
- Unknown keys are kept unchanged when the app saves the note, and are otherwise ignored.
- A key with an invalid value is ignored and kept unchanged.
- The app never adds or changes front matter on its own. It writes front matter only when the
  person changes one of these fields through the app, with one exception: `id`.
- **Writing `id`.** An app may give an `id` to a note that has none, or whose `id` is invalid or
  already used by another note. It replaces the value on the last top-level `id:` line; or, if
  there is no such line, adds a line `id: …` immediately before the closing `---`; or, if the
  file has no front matter, adds a front matter block holding only `id` at the start of the
  file, after a byte order mark if there is one. An inserted line uses the line ending of the
  opening `---` line, or of the file's first line. Nothing else in the file changes. An app
  never does this to a file that is not valid UTF-8, or to a file whose first line is `---`
  and that has a later `---` line with lines between them that are not blank and are not a
  YAML mapping.
- Front matter that the app writes when the person creates a note through it (`id`, `created`
  and `title`) counts as the person's change.

## 4. Base syntax

The body is CommonMark 0.31.2 with these GitHub Flavored Markdown extensions: tables,
strikethrough, task list items and extended autolinks.

There is one difference from CommonMark: **HTML is not recognised.** Neither HTML blocks nor
inline HTML exist in this format. Text that CommonMark would treat as HTML is parsed as ordinary
Markdown text, and `<` and `>` are shown literally. Autolinks such as `<https://example.com>` are
not HTML and work as in CommonMark.

## 5. Extras

There are three constructs: the styled span (5.1), two shorthand marks (5.2) and the block
attribute line (5.4). Spans and block attribute lines carry an attribute list (5.3).

A note is parsed in this order:

1. Front matter is separated from the body (section 3).
2. The body is divided into blocks by the CommonMark and GFM block rules, with HTML blocks off.
   The extras play no part in this step. Task list markers are recognised in this step.
3. Block attribute lines are identified among the finished blocks (5.4).
4. The inline text of each block is parsed in four passes:
   1. **Scan pass.** One left-to-right scan finds code spans, CommonMark autolinks
      (`<https://example.com>`), styled spans, links and images (5.1).
   2. **Mark pass.** `++` and `==` marks are found in each inline scope (5.2).
   3. **Bare URL pass.** GFM extended autolinks (`https://example.com`, `www.example.com`, email
      addresses) are found by the GFM rules in each run of literal text that the first two passes
      left, in every inline scope except link text. A run of literal text never includes a
      delimiter that an earlier pass recognised, so a bare URL ends before the `]` of a span or
      the `++` of a mark. Where GFM asks what comes before a bare URL, the start of an inline
      scope counts as the start of a line. The text of a bare URL takes no part in the emphasis
      pass, so `https://example.com/_draft_/page` is one link. GFM's rule that trailing
      punctuation is not part of the link still applies, and it counts `_` as punctuation:
      `https://example.com/_draft_` is a link to `https://example.com/_draft` followed by `_`.
      Only `http://`, `https://`, `www.` and email addresses start a bare URL.
   4. **Emphasis pass.** Emphasis and strikethrough are found in each inline scope, by the
      CommonMark and GFM rules.

For inline parsing, each cell of a table is treated as a block of its own.

Because the mark pass runs before the bare URL pass, `https://example.com/==go==` is a link to
`https://example.com/` followed by a highlighted `go`. A URL that contains `==` or `++` in such a
position is written as a CommonMark autolink, `<https://example.com/==go==>`.

An **inline scope** is one of: the inline text of a block outside any of the following; the
content of a styled span; the text of a link; the description of an image; the content of a
shorthand mark. Delimiters of marks, emphasis and strikethrough pair only with delimiters in the
same scope. The tests that decide whether a delimiter run can open or close look at the
characters next to the run in the source text, whatever construct those characters belong to.

### 5.1 Styled span

```
[content]{attributes}
```

A styled span applies text colour, highlight, font family, font size and underline to a run of
inline text.

**The scan pass.** The inline text of a block is scanned once from left to right with a stack of
open brackets. Whatever the scan recognises is consumed, and the scan continues after it.

- At a backtick, a code span is recognised if CommonMark finds one starting there. At a `<`, an
  autolink is recognised if CommonMark finds one starting there. The text of a code span or
  autolink is not scanned.
- An unescaped `[` or `![` is pushed on the stack.
- At an unescaped `]`, if the stack is empty, the `]` is literal text. Otherwise the top of the
  stack is its opening bracket, and these tests are made in order:
  1. **Span.** If the opening bracket is `[`, the character directly after the `]` is the `{` of
     an attribute list (5.3), the text between the brackets is not empty, and no styled span has
     been recognised between the brackets, then this is a styled span. The attribute list is
     consumed and not scanned.
  2. **Link or image.** Otherwise, if the brackets, with what follows this `]`, form a link or
     image by the CommonMark rules (an inline link, or a full, collapsed or shortcut reference),
     it is that link or image. Its destination and title, or its reference label with its
     brackets, are consumed and not scanned.
  3. **Neither.** Otherwise both brackets are literal text.

  In all three cases the opening bracket is popped from the stack.
- An opening bracket still on the stack at the end of the block is literal text.
- CommonMark's rule that a link cannot contain another link still applies to links. It does not
  stop an enclosing pair of brackets from becoming a styled span.

Consequences:

- **Spans do not nest.** In `[a [b]{color=red} c]{bg=blue}`, `[b]{color=red}` is a span, and
  `[a `, ` c]` and `{bg=blue}` are literal text.
- **Plain bracket pairs are harmless.** In `[see [1] for details]{color=red}` the whole phrase is
  one span. `[1]` inside it is literal text, or a link if the note defines `[1]: /url`.
- **Code and link destinations are skipped.** In ``[a `]` b]{color=red}`` the `]` in the code
  span is not a bracket, and the whole phrase is one span. In `[x](u]v)` the `]` in the
  destination is not a bracket.
- **No space before the brace.** `[text] {color=red}` is not a span.
- **A span wins over a shortcut reference.** `[yes]{color=green}` is a span even if the note
  defines `[yes]: /url`.
- **A link that is already complete is not a span.** `[text](url){color=red}` is a link followed
  by literal braces. If `[b]: /url` is defined, `[a][b]{color=red}` is a full reference link,
  recognised at the first `]`, followed by literal braces. If `[b]` is not defined, `[a]` is
  literal text, whether or not `[a]` is defined, because CommonMark does not allow a shortcut
  reference to be followed by another bracketed label; `[b]{color=red}` is a span.
- To style a link, put it inside a span: `[see [the guide](https://example.com)]{color=red}`.
- A span may be used inside link text: `[[red]{color=red} and plain](https://example.com)`.
- `![alt]{width=50%}` is not a span, because its opening bracket is `![`; the braces are literal
  text. For the same reason `Wow![great]{color=red}` is not a span. Write `Wow\![great]{color=red}`.
- A task list marker is `[ ]`, `[x]` or `[X]` at the start of a list item, followed by a space or a tab.
  It is taken in step 2 and is never inline text. `- [x]{color=red} done` has no task marker: it
  is a list item that starts with the span `[x]{color=red}`.

**Content.**

- Content may contain bold, italic, strikethrough, inline code, links, images and the shorthand
  marks. It is an inline scope: in `**a [b** c]{color=red}` the span is recognised and both `**`
  are literal text.
- Content may continue over a line break inside a paragraph. It cannot cross a block boundary.
- In a table cell, a `|` inside a span must be written `\|`, as anywhere else in a cell.

Examples:

```
[flight is delayed]{color=red}
[window seat]{bg=mint}
[a postcard line]{font="Caveat"}
[small print]{size=small}
[C++]{underline=yes}
[**Do not forget the passport**]{color=white bg=red font="Inter" size=large underline=yes}
```

Several styles on the same text go in one span. A differently styled word inside a styled phrase
is written as side-by-side spans:

```
[The title is ]{font="Georgia"}[Saudade]{font="Georgia" color=red}[, in two colours.]{font="Georgia"}
```

### 5.2 Shorthand marks

| Written | Meaning |
|---|---|
| `++text++` | Underline. The same as `[text]{underline=yes}`. |
| `==text==` | Highlight in the theme's default highlight colour. The same as `[text]{bg=highlight}`. |

A delimiter run is a maximal sequence of unescaped `+` characters, or of unescaped `=`
characters. Only a run of exactly two characters can be a delimiter. Runs of any other length are
literal text.

- A run can **open** a mark if the character after it is not whitespace and it is not at the end
  of its scope, and the character before it is not a letter or digit.
- A run can **close** a mark if the character before it is not whitespace and it is not at the
  start of its scope, and the character after it is not a letter or digit.
- A run at the very start of its scope has no character before it, and a run at the very end
  has none after it. A missing character counts as neither whitespace nor a letter or digit.
- The mark pass works on one inline scope at a time, from left to right. The first run that can
  open pairs with the next run of the same character, in the same scope, that can close and has
  at least one character between them. Any `++` or `==` runs between the two are not
  paired at this level. Pairing then continues after the closing run. A run that finds no partner
  is literal text.
- The content of a mark is an inline scope, and the mark pass is then applied to it. So a mark
  may contain a mark of the other kind, and never one of its own kind directly.
- Because scopes are separate, a mark never crosses the edge of a span, a link or another mark,
  and emphasis never crosses the edge of a mark. In `*a ++b* c++`, `b* c` is underlined and both
  `*` are literal text.
- A mark may contain a styled span, and a span's content may contain marks.
- A line made only of `=` characters under a paragraph is a CommonMark setext heading underline,
  decided in step 2. It is never a highlight.

Examples:

```
++book by Friday++                 underlined
==pack sunscreen==                 highlighted
++[underlined and red]{color=red}++
*italic with ++underline++ inside*
if x==1 and y==2                   no highlight: each run touches a letter or digit on the wrong side
a++b++c                            no underline, for the same reason
```

Ordinary text can still form a mark by accident: in `A ==> B, then C <== D` the two runs pair,
and so do the runs in `use ++i here, not i++`. A backslash before the run prevents it:
`A \==> B` and `use \++i here`.

### 5.3 Attribute list

```
{key=value key=value}
```

An attribute list is written on one line. It is `{`, optional spaces, one or more attributes
separated by one or more spaces, optional spaces, `}`. A space here is the character U+0020
only; a tab is not a space. The list ends at the first `}` that is not inside a quoted string, so
`{font="a}b"}` is one attribute list.

- An attribute is `key=value` with nothing between the key, the `=` and the value.
- A key is one or more lower-case ASCII letters.
- A value is a bare word or a quoted string.
  - A bare word is one or more ASCII letters, ASCII digits, `#`, `%`, `.`, `-` or `_`.
  - A quoted string starts and ends with a double quote and stays on one line. Inside it, `\"`
    is a double quote and `\\` is a backslash. A backslash before any other character is a
    literal backslash. Spaces inside a quoted string do not separate attributes.
  - The value of a quoted string is its text without the quotes and with the escapes resolved.
    Validation uses that value, for every key: `color="red"` means the same as `color=red`.
- CommonMark backslash escapes do not apply inside an attribute list.

Text that does not match this syntax is not an attribute list. `{color = red}`,
`{font=IBM Plex Serif}`, `{font=Café}` and `{font="a\"}` are not attribute lists.

**For a span, syntax decides whether it is recognised; validity decides what applies.** A span
whose braces hold an attribute list is recognised, and its brackets and braces are not shown,
even if some or all of its attributes are unknown or invalid. `[x]{color=redd}` is a span that
shows a plain `x`. A block attribute line has one more condition, given in 5.4.

| Key | Allowed on | Value |
|---|---|---|
| `color` | span, paragraph, heading | colour value |
| `bg` | span, paragraph, heading | colour value, or `highlight` for the theme's default highlight colour |
| `font` | span, paragraph, heading | font value |
| `size` | span, paragraph, heading | size value |
| `underline` | span, paragraph, heading | `yes` or `no` |
| `width` | image | a whole number from `1` to `100` followed by `%`, meaning a percentage of the text width, or a whole number from `16` to `4000` followed by `px` |

- An attribute with an unknown key, a key not allowed in that place, or an invalid value is
  ignored. The other attributes still apply.
- If a key appears more than once, only its last occurrence counts. If that occurrence is
  invalid, the key is ignored.
- Palette names, `highlight`, generic font names, named sizes, `yes`, `no` and hex digits are
  matched without regard to case. Keys are lower case only.

**Colour value.** One of:

- a palette name: `red`, `orange`, `yellow`, `green`, `mint`, `teal`, `blue`, `indigo`,
  `purple`, `pink`, `brown`, `gray`, `black`, `white`. The exact shade comes from the theme, so
  it stays readable in light and dark themes;
- a hex colour, `#rgb` or `#rrggbb`, used exactly as written in every theme.

**Font value.** A font family name, such as `Georgia` or `"IBM Plex Serif"`, or one of the
generic names `serif`, `sans` and `mono`. In an attribute list, a name that is not a bare word
must be quoted. If the font is not available, the text keeps the font it would have had without
the attribute.

**Size value.** One of:

- a named size, which multiplies the size the text would have had without this attribute: `xs`
  0.75, `small` 0.875, `normal` 1, `large` 1.25, `xl` 1.5, `xxl` 2. On a block attribute line the
  base is the block's own size (the heading's size for a heading, the note's body size for a
  paragraph). On a span the base is the size of its block after any block attribute line. So
  `[x]{size=large}` in a heading is larger than the rest of the heading, and in a paragraph with
  the block attribute line `{size=small}` it is 0.875 × 1.25 of the body size;
- pixels: a whole number from `6` to `200` followed by `px`, such as `22px`. Pixels are absolute;
- points: a number from `1` to `400`, with at most one decimal, followed by `pt`, such as `14pt`
  or `10.5pt`. Points are absolute, as pixels are (1pt is 4/3 px). A value such as `012pt`,
  `14.pt`, `14.25pt` or `0.5pt` is not a size value.

### 5.4 Block attribute line

A block attribute line styles the whole block above it. A line is a block attribute line only if
all of these hold:

1. The line contains an attribute list (5.3) and nothing else except optional spaces around it.
2. The line after it is blank, or it is the last line of the file.
3. The line before it is not blank.
4. At least one attribute in the list has a key that is allowed for the block it would apply
   to (5.3): `width` for an image; `color`, `bg`, `font`, `size` or `underline` for a heading or
   paragraph. So a line such as `{a=1 b=2}` under a paragraph is literal text and stays visible.
5. One of these three cases applies. They are tested in this order.
   - **Heading.** The line before it is an ATX heading (`# Heading`) that is a direct child of
     the document. The attributes apply to the heading.
   - **Image.** The line is the last line, and not the only line, of a paragraph that is a direct
     child of the document, and the rest of that paragraph, parsed as inline text, is exactly
     one image and nothing else. The attributes apply to the image. The only key allowed is
     `width`.
   - **Paragraph.** The line is the last line, and not the only line, of any other paragraph that
     is a direct child of the document. The attributes apply to the paragraph.

In every other position, a line holding an attribute list is literal text. That includes:

- a line inside a list item or block quote, or directly under one, where it is a continuation of
  that item or quote;
- a line directly under a table, where GFM makes it a table row;
- a line directly under a setext heading, a code block or a horizontal rule, where it is a
  paragraph of one line;
- a line indented by four or more spaces under a heading, where it is an indented code block;
- a line with a blank line above it, and a line in the middle of a paragraph.

An attribute list that is not part of a styled span or a block attribute line is always literal
text.

A block attribute line is not shown and is not part of the text of its block. Styled spans may
be used inside a block that has one; that is not nesting, because the block attribute line is not
a span.

Examples:

```
This whole paragraph is grey and small.
{color=gray size=small}

# A red heading
{color=red}

![Tram 28 at dusk](<Lisbon trip.assets/tram.jpg>)
{width=70%}
```

### 5.5 Which style wins

For `font`, from weakest to strongest: the theme, the note's front matter, a block attribute
line, a styled span. `color` follows the same order without the front matter, which has no colour
key. A stronger level overrides a weaker one for that property only; the other properties are
inherited. `size` follows the same order as `font`, with named sizes multiplying as described in
5.3.

For the background, from weakest to strongest: a block attribute line's `bg`, a `==` mark, a
styled span's `bg`. This holds whichever of them encloses the other: `==[x]{bg=red}==` and
`[==x==]{bg=red}` both show `x` on red.

Underline is decided for each piece of text by the first of these that applies:

1. The text is inside a `++` mark: it is underlined.
2. The text is inside a span that sets a valid `underline`: that value decides.
3. The block has a block attribute line that sets a valid `underline`: that value decides.
4. Otherwise it is not underlined.

So `underline=no` on a span cancels a block-level underline for that span, and has no effect
inside a `++` mark.

### 5.6 Escaping and code

- CommonMark backslash escapes apply in inline text. A backslash before `[`, `]`, `{`, `}`, `+`
  or `=` makes that character literal. Inside an attribute list, only the rules of 5.3 apply.
- Nothing in section 5 is recognised inside inline code, fenced code blocks or indented code
  blocks.

## 6. Photos

- A photo is an ordinary image file. It is never embedded in the note.
- A note's photos are stored in a folder next to the note, named after the note's file name with
  `.assets` in place of `.md`: `Lisbon trip.md` has `Lisbon trip.assets/`.
- The note refers to a photo with a standard Markdown image: `![Tram 28 at dusk](<Lisbon trip.assets/tram.jpg>)`.
- A path that contains spaces is written in angle brackets, as in CommonMark, or with `%20`.
- An image destination is classified as written, before any decoding. If it starts with
  `http://` or `https://`, in any letter case, it is a remote image. Anything else is a local
  path, including a path whose first part contains a colon, such as `Re: Lisbon.assets/tram.jpg`.
- In a local path, a `%` followed by two hexadecimal digits is decoded. Any other `%` is a
  literal `%`.
- A relative path is resolved against the folder that contains the note. A local image is loaded
  only if the file it finally points to, after any symbolic links are followed, is inside the
  notes folder the person opened. Absolute paths and paths that leave that folder are not loaded.
- A remote image is never loaded automatically. It is loaded only after the person allows it.
  Allowing it does not change the file.
- An image that is missing or not loaded is shown as a placeholder with its alt text and its
  path or URL.
- The alt text describes the photo and may be shown as its caption.
- Supported image types: JPEG, PNG, GIF, WebP and AVIF.
- When the app renames a note, it renames the `.assets` folder and updates the image paths in
  the note.
- An app may be stricter than the rules above: it may load local images only from the note's
  own `.assets` folder, and it may never load remote images.

## 7. Changing a note by program

The file on disk is the only source of truth. A note is never regenerated from a parsed tree.
When the app changes a note, text that the change does not need to touch stays exactly as it
was: spacing, blank lines, list markers, table alignment, attribute order, escapes and unknown
front matter keys.

When the app sets or removes a style (`color`, `bg`, `font`, `size` or underline) on a selection
of text, the result must satisfy all of these. If no edit can, the app makes no change.

1. **Outside the selection, nothing changes on screen.** Every character outside the selection
   is rendered exactly as before, with the same styles.
2. **Inside the selection, only the requested property changes.** The same characters are shown,
   with every other style as before.
3. **The result follows this specification.** In particular, no span is inside another span.
4. **The change to the file is local.** The edit rewrites no more of the source text than it
   needs in order to satisfy guarantees 1 to 3.

These facts about the format are what make such edits possible:

- `++text++` renders the same as `[text]{underline=yes}`, and `==text==` the same as
  `[text]{bg=highlight}`.
- A span can always be divided into side-by-side spans that each carry a copy of its attribute
  list, and side-by-side spans whose attribute lists are equal after validation render the same
  as one span, provided the text between the new brackets still parses the same way.

The step-by-step procedure for these edits is not part of the format. It belongs to the editor's
design and is specified and tested there.

## 8. Grammar of the extras

The grammar gives the shape of each construct. Which text is `content`, and which runs are
delimiters, is decided by the rules in 5.1 and 5.2, not by this grammar.

```
styled-span = "[" content "]" attr-list
underline   = "++" content "++"
highlight   = "==" content "=="
block-attrs = *SP attr-list *SP                 ; alone on its line, see 5.4; SP is U+0020
attr-list   = "{" *SP attribute *( 1*SP attribute ) *SP "}"
attribute   = key "=" value
key         = 1*( %x61-7A )                     ; a-z
value       = bare / quoted
bare        = 1*( %x41-5A / %x61-7A / %x30-39 / "#" / "%" / "." / "-" / "_" )
quoted      = DQUOTE *( qchar / escape / lone ) DQUOTE
escape      = "\" DQUOTE / "\\"
lone        = "\" qchar                         ; a literal backslash, then that character
qchar       = any character except DQUOTE, "\", CR and LF
```

## 9. Complete example

````markdown
---
title: Lisbon trip
tags: [travel, portugal]
created: 2026-11-10
updated: 2026-11-10
font: Source Serif 4
size: 17px
theme: paper
---

# Lisbon trip
{color=indigo}

## Plain Markdown

A **bold** plan, an *italic* mood, ***both at once***, and ~~a cancelled idea~~.
Run `convert --eur` before paying. See [the city guide](https://example.com/lisbon).

> "Saudade" has no exact translation.
> It is closer to a feeling than a word.

---

## The extras

- Underline: ++book by Friday++
- Underline as an attribute: [C++]{underline=yes}
- Highlight: ==pack sunscreen==
- Highlight in another colour: [window seat]{bg=mint}
- Text colour: [flight is delayed]{color=red} or by hex [like this]{color=#2b6cb0}
- Font: [a handwritten postcard line]{font="Caveat"}
- Size: [small print]{size=small}, [large]{size=large}, [exact]{size=22px}
- Combined: [**Do not forget the passport**]{color=white bg=red font="Inter" size=large}
- Mixed: **bold with a [red word]{color=red} inside**, and *italic ++underlined++*
- Two fonts on one line: [Playfair]{font="Playfair Display"} beside [Mono]{font=mono}
- A styled link: [see [the guide](https://example.com)]{color=red}
- Plain brackets in a span: [see note [1] below]{color=gray}

This whole paragraph is grey and small, set by the line below it.
{color=gray size=small}

## Lists

- Pack charger
  - Plug adapter
  - [Spare battery]{color=red}
- Pack ==sunscreen==

1. Book flights
2. Reserve hotel
   1. Near Alfama
   2. Breakfast included

- [x] Passport renewed
- [ ] Travel insurance

## Table

| Item    | Cost (EUR) | Paid               |
|:--------|-----------:|:------------------:|
| Flights |        240 | [yes]{color=green} |
| Hotel   |        510 | ==no==             |

## Code

```python
total = sum([240, 510])
print(f"Total: {total} EUR")
```

## Photos

![Tram 28 at dusk](<Lisbon trip.assets/tram.jpg>)
{width=70%}

![Tiles in Alfama](<Lisbon trip.assets/tiles.jpg>)
````

## 10. Not in this draft

These are deliberately left for later and are not gaps to report: links between notes, heading
anchors, mathematics, footnotes, text alignment, limits on note size, how themes are written,
and the editor's procedures for changing a note (section 7 states only what they must
guarantee).

## 11. History

Version 1.0 follows four drafts written on 2026-11-10. Each draft was reviewed by 11 to 15 AI
models working independently, and the user decided the open points after each round.

- **Draft 1** set the base: one `.md` file per note, CommonMark plus GFM, bracket spans, no
  nesting.
- **Draft 2** added the underline attribute, exact rules for the block attribute line, front
  matter recognition, the parse order and consent for remote images.
- **Draft 3** made span, link and image recognition a single left-to-right pass, made the
  content of a mark its own inline scope, added `bg=highlight`, and made named sizes relative to
  the surrounding text.
- **Draft 4** took the step-by-step editing procedure out of the format, leaving the guarantees
  in section 7, and fixed how code spans, link destinations and bare URLs interact with spans.
- **Version 1.2** adds points to the size value (`14pt`, `10.5pt`), for the editor's font size
  box (`EDITOR-PLAN.md` section 4). Pixels and named sizes stay valid.
- **Version 1.1** was made for the web app design: a note's identity is a new front matter
  key, `id`, which an app may write; an editor may convert mixed line endings on save; and an
  app may limit which images it loads.
- **Version 1.0.1** clarifies points found while the first parser was written and reviewed: the
  bare URL example and the schemes that start one, `[X]` as a task marker, an indented line under
  a heading, the accepted date forms, a lone CR, and the front matter font not applying to code.
- **Version 1.0** applies the last review's fixes: a block attribute line needs at least one
  allowed key; bare URLs are found before emphasis; a task marker needs a following space; a
  byte order mark is ignored; the YAML schema and scalar handling are fixed; only `http://` and
  `https://` destinations are remote.

The earlier drafts and all reviews are kept beside this file.
