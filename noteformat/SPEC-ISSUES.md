# Points in SPEC.md 1.0.1 that are still open

Each point gives the section, a concrete input, the readings, and what this implementation does.
Version 1.0.1 settled the earlier points about `https://example.com/_draft_`, `[X]` task markers,
an indented line under a heading, the accepted date forms, a lone CR, the front matter font and
code, and the schemes that start a bare URL, all as this implementation already did them; they are
no longer listed. The `\\|` table point is gone too: tables now split rows the GFM way for both
structure and cells.
Where the spec could be read more than one way, the most literal reading was implemented, unless
that reading is unsafe or self-contradictory; the point says so when that happens.

## 1. Section 5, pass 3: scopes inside link text

"…in every inline scope except link text." Link text can contain other scopes: a styled span
(`[[www.example.com]{color=red}](/u)`) or a mark (`[==www.example.com==](/u)`). Read literally,
the span's content is "the content of a styled span", not link text, so a bare URL would be found
in it, and the result would be a link inside a link, which CommonMark forbids and HTML cannot
represent.

**Implemented:** no bare URL is found in link text or in any scope nested inside link text.

## 2. Section 6: "classified as written, before any decoding" — which decoding?

A CommonMark destination is itself decoded: backslash escapes and entity references are resolved,
and `<…>` brackets are removed. "As written" could mean the raw source text or the destination
CommonMark gives.

- Input: `![x](https&#58;//evil.example/x.png)` — raw text is not `https://`, the CommonMark
  destination is.
- Input: `![x](<Lisbon trip.assets/tram.jpg>)` — the raw text starts with `<`.

**Implemented:** classification uses the CommonMark destination (escapes and entities resolved,
angle brackets removed), and "before any decoding" is read as "before percent-decoding". The raw
reading would make the first input a local path; it would still not load anything remote here,
because local paths are percent-encoded segment by segment (`https%3A//…`), but classifying the
destination CommonMark yields is the safer and more useful reading. `data-src` on the placeholder
holds that destination.

## 3. Section 6: percent-decoding that yields invalid UTF-8

"A `%` followed by two hexadecimal digits is decoded." The decoded bytes may not be UTF-8.

- Input: `![x](%FF.jpg)`

**Implemented:** the image is not loaded (placeholder). Decoding to U+FFFD would point at a file
name that cannot exist.

## 4. Section 6: supported image types

"Supported image types: JPEG, PNG, GIF, WebP and AVIF." The spec does not say how the type is
decided, nor what happens to another type.

- Input: `![x](diagram.svg)`

**Implemented:** a local image whose path does not end in `.jpg`, `.jpeg`, `.png`, `.gif`,
`.webp` or `.avif` (any case) is not loaded and shows the placeholder. Remote images are not
type-checked. See README "Known gaps".

## 5. Section 5.4: an image paragraph whose list has no `width`

Case Image is tested before case Paragraph, and condition 4 then asks for a key allowed for the
image, which is only `width`.

- Input: `![x](a.png)\n{color=red}`
- Reading A: the Image case applies, condition 4 fails, the line is literal text.
- Reading B: the line falls through to the Paragraph case and colours the paragraph.

**Implemented:** reading A, the order as written: the image is followed by a soft break and the
literal text `{color=red}`.

## 6. Section 5 vs 5.2: what is "the character before" a run at the start of a scope

Section 5 says the tests "look at the characters next to the run in the source text, whatever
construct those characters belong to". 5.2 says "A run at the very start of its scope has no
character before it".

- Input: `[==x==]{color=red}` — in the source the character before the first `==` is `[`; by 5.2
  there is none.

**Implemented:** marks use 5.2 (a run at the start or end of its scope has no character on that
side); emphasis uses the source text, with the start and end of the block counting as whitespace
as in CommonMark. For marks the two readings give the same result in every case I could build: a
scope edge in the source is always next to `[`, `]`, `+`, `=`, `|`, a space or a line end, none of
which is a letter or digit, and the whitespace tests apply only to the inner side of a run.

## 7. Section 5.3: what is a valid font family name

"A font family name, such as `Georgia` or `"IBM Plex Serif"`." Nothing says which names are
invalid.

- Input: `[x]{font=""}` and `[x]{font="   "}`

**Implemented:** any value with a character other than whitespace is a valid family name; an
empty or all-whitespace value is invalid. The name is written as a CSS string in single quotes,
with `'` and `\` escaped.

## 8. Section 5.3: leading zeros and unit case in sizes and widths

"A whole number from `6` to `200` followed by `px`."

- Input: `[x]{size=022px}`, `![x](a.png)\n{width=070%}`, `[x]{size=22PX}`

**Implemented:** digits with leading zeros are accepted when the number is in range, and the value
is written to CSS as written (`font-size: 022px`, which CSS accepts). `px` and `%` are not in the
list of values matched without regard to case, so `22PX` is invalid.

## 9. Section 3: an empty scalar

"The value of a scalar is its text as written in the file." `title:` has no text; YAML reads it as
null.

- Input: `---\ntitle:\n---\n# Heading`

**Implemented:** an empty value (`title:`, `title: ""`) is invalid for every known key, so the
title falls back to the first level-1 heading. `title: null` and `title: ~` are not empty: they
give the titles `null` and `~`, since values are not converted.

## 10. Section 3: "its text as written … without quotes" for escapes and folded lines

- Input: `title: "Café"` and a plain title folded over two lines.

**Implemented:** the YAML value: escapes in double-quoted scalars are resolved (`Café`) and
multi-line scalars are folded, as YAML defines. "As written" is read as "not converted to a
number, boolean or null".

## 11. Section 3: "the first level-1 heading"

- Input: `> # Quoted title\n\n# Real title`, and `#\n\n# Title` (an empty heading first).

**Implemented:** the first level-1 heading in document order at any depth (including inside block
quotes and list items), ATX or setext, skipping headings whose text is empty. The title is the
heading's plain text, without markup.

## 12. Section 5.5: may the theme underline links?

5.5 says text is underlined only by a `++` mark, a span or a block attribute line, and "otherwise
it is not underlined". Browsers and most themes underline links.

- Input: `[a link](/u)`

**Implemented:** links are not underlined, so that rule 4 holds; the theme shows links by colour.

## 13. Section 5, pass 3: GFM spec text and cmark-gfm differ; backslash escapes in URLs

Which schemes start a bare URL is now settled (`http://`, `https://`, `www.`, email). Still open:
GFM's reference implementation accepts `http://localhost` (no period) and does not check the
character before an email address; the GFM spec text requires a valid domain with a period, and
says all extended autolinks come only at the start of a line, after whitespace, or after `*`, `_`,
`~` or `(`. The spec also does not say how a backslash escape inside a bare URL is treated.

- Input: `http://localhost:3000`, `x:foo@bar.com`, `https://a.example/\_x`

**Implemented:** the GFM spec text. The first two are not links. A URL ends before a backslash
escape, so the third is a link to `https://a.example/` followed by `_x`.

## 14. Section 5.4: condition 3 is implied by condition 5

Every case of condition 5 already has a non-blank line before the attribute line (the heading, or
an earlier line of the same paragraph), so condition 3 never decides anything. Not a defect;
noted because a reader may look for an input that only condition 3 rejects.
