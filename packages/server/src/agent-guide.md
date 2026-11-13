# Nook for agents

Nook is a private notes app. With a token that a person made for you, you can list, read,
create and save that person's notes and drawings over HTTP. This page is all you need; it needs
no token.

- Server: `{{SERVER}}`
- Every address below begins `{{SERVER}}/api/agent/v1`
- Send the token with every request but this page: `Authorization: Bearer nook_…`

The examples use `curl` and these shell variables: `NOOK_TOKEN` (your token), `ID` (an item's
id), `REVISION` and `VERSION` (values from earlier answers).

**The certificate.** Nook is one person's own server. Unless its owner has given it a domain
name, it uses a certificate it made itself (issued by "Caddy Local Authority", often naming
only `localhost`), which `curl` does not verify. That is expected, and the owner knows: add
`-k` to every `curl` command for this server. The connection is still encrypted. If you need
the owner's say-so before you skip the check, ask once, and say that this page told you to.

## What you cannot do

There is no route to delete, to move to the trash, to restore from the trash, or to add or open
a photo. Do not look for one. If something must be removed, tell your person. You see and change
only the items of the person whose token you have.

## Items

An item is a **note** or a **drawing**. Its `id` is 24 characters of `a-z` and `2-7`.

| Kind | The document | Content-Type | Limit |
|---|---|---|---|
| note | Markdown, with front matter at the top | `text/markdown` | 2 MB |
| drawing | an Excalidraw file (JSON) | `application/vnd.excalidraw+json` | 25 MB |

A note looks like this. The lines between the two `---` lines are its front matter:

```markdown
---
title: "Shopping"
tags: [food, home]
created: 2026-11-12
---

- oats
- two lemons
```

A **tag** is 1 to 30 lower-case letters `a` to `z`. `food` is a tag; `meeting-notes`, `2026` and
`Food` are not.

The answer to a create, a read, a save and an append has `entry` (the item's `id`, `kind`,
`title`, `tags`, `created`, `modified`, `size`, and `agent`: the name of the agent that last
wrote it, or `null` for a person), and `url`: the page to give your person.

## List and search

```sh
curl -sS "{{SERVER}}/api/agent/v1/items" -H "Authorization: Bearer $NOOK_TOKEN"
```

Answer: `{ "entries": [ … ], "tags": [ { "tag": "food", "count": 3 } ] }`, newest first. Add
`?q=lemons` to search titles, tags and text, and `?tag=food` for one tag.

## Create a note

Put the Markdown in a file, `note.md`, without front matter, and give the title and tags in the
address. The server writes the front matter.

```sh
curl -sS -X POST "{{SERVER}}/api/agent/v1/items?title=Shopping&tags=food,home" -H "Authorization: Bearer $NOOK_TOKEN" -H "Content-Type: text/markdown" --data-binary @note.md
```

Answer, status 201: `{ "id": "…", "revision": "…", "entry": { … }, "text": "…", "url": "…" }`.

- Without `title`, the note's title is its first heading.
- You may instead send a note that already has front matter; then leave `title` and `tags` out
  of the address.
- Always use `--data-binary`. Plain `-d` removes the line breaks.
- If the answer to a create is lost, list before you send it again, or you make two notes.

## Formatting a note

Everything a person can do to a note with Nook's toolbar, you can write as text. This section
lists all of it. Plain Markdown is enough for most notes; the rest is for colour, size, fonts,
underline and highlight.

### What the editor offers, and how to write it

| In the editor | Written as |
|---|---|
| Title, tags | `title` and `tags` in the front matter (see Items) |
| Bold | `**text**` |
| Italic | `*text*` |
| Underline | `++text++` |
| Strikethrough | `~~text~~` |
| Inline code | `` `text` `` |
| Text colour | `[text]{color=red}` |
| Highlight | `==text==` for the usual yellow, or `[text]{bg=mint}` for another colour |
| Font | `[text]{font=serif}` |
| Size | `[text]{size=14pt}` |
| Link | `[text](https://example.com)`; a bare `https://…` address is a link too |
| Normal text | a paragraph: lines of text, with an empty line between paragraphs |
| Heading 1 to 6 | `# Heading` to `###### Heading` |
| Quote | `> text` at the start of each line |
| Code block | a line of three backticks (or three `~`), the code, and the same line again; a language name may follow the first, as in the example |
| Bullets | `- item` |
| Numbers | `1. item` |
| Tasks | `- [ ] to do` and `- [x] done` |
| Table | rows of cells between `\|`, with a line of dashes under the first row |
| Horizontal line | `---` on a line of its own, with an empty line before and after |
| Photo | you cannot add one; see below |
| Saved styles | no form of their own: a saved style is the colour, highlight, font, size, bold, italic, underline and strikethrough it holds, so write those |
| Note settings: font, size, paragraph spacing | `font`, `size` and `spacing` in the front matter |

This complete note uses most of it:

```markdown
---
title: "Lisbon trip"
tags: [travel]
created: 2026-11-12
font: serif
size: 17px
spacing: 1.5
---

# Lisbon trip
{color=indigo}

Leave on [Friday the 14th]{color=red}, and ++book the tram tickets++ before then.
Pack ==sunscreen== and the [window seat]{bg=mint} confirmation, and ~~the umbrella~~.

[**Do not forget the passport**]{color=white bg=red size=large}

This paragraph is grey and small, set by the line under it.
{color=gray size=small}

## To do

- [x] Renew the passport
- [ ] Buy insurance
  - compare [two offers]{color=blue}
- [ ] Run `convert --eur` before paying

1. Book the flights
2. Reserve the hotel
   - near Alfama

> "Saudade" has no exact translation.
> It is closer to a feeling than a word.

See [the city guide](https://example.com/lisbon).

---

## Costs

| Item    | Cost (EUR) | Paid               |
|:--------|-----------:|:------------------:|
| Flights |        240 | [yes]{color=green} |
| Hotel   |        510 | ==no==             |

~~~python
total = sum([240, 510])
~~~
```

### The forms Nook adds

- **A styled span** is `[text]{key=value key=value}`: brackets round the text, then braces. It
  works anywhere text does: in a paragraph, a list item, a table cell, a quote, a heading, and
  round other formatting such as `**bold**` or a link.
- **One span, all its keys.** A span cannot be put inside another span, and two sets of braces
  cannot follow one text: for red text on mint write `[text]{color=red bg=mint}`.
- **A block line** is a line holding only `{key=value}`, straight under a heading or as the
  last line of a paragraph, with an empty line after it. It styles the whole heading or
  paragraph. It does not work under a list, a table or a quote: use spans there.
- **Shorthand:** `++text++` is underline and `==text==` is highlight.
- **For the whole note,** in the front matter: `font`, `size`, and `spacing` (the gap between
  paragraphs, a number from 0 to 5; 1 is the usual gap).

| Key | Values |
|---|---|
| `color` | `red`, `orange`, `yellow`, `green`, `mint`, `teal`, `blue`, `indigo`, `purple`, `pink`, `brown`, `gray`, `black`, `white`, or a hex colour such as `#2b6cb0` |
| `bg` | the same, or `highlight` (the usual yellow, as `==text==`). The editor's twelve highlighter shades are hex colours: yellow `#fff176`, amber `#ffd68a`, peach `#ffc09f`, rose `#ffb3b3`, pink `#ffb8de`, purple `#e3c2ff`, lavender `#c9ceff`, blue `#b3dcff`, aqua `#a8ecf0`, mint `#b2f0d0`, green `#c5f09a`, silver `#dcdce0` |
| `size` | points, as the editor's size box writes: `14pt` (from `1pt` to `400pt`, one decimal at most); or pixels from `6px` to `200px`; or `xs`, `small`, `normal`, `large`, `xl`, `xxl`, which scale the size the text would have had |
| `font` | `serif`, `sans`, `mono`; or the name of a font the person has added on Nook's Fonts screen, in quotes when it has a space: `font="Source Serif 4"` |
| `underline` | `yes` or `no` |

The syntax is strict, and a mistake is never reported: it is only shown.

- Write `key=value` with nothing round the `=`, keys in lower case, and one space between
  pairs. `{color = red}` and `{Color=red}` are not read, and the braces show in the note as
  typed.
- A key or value that is not in the table is ignored: `[x]{color=crimson}` shows a plain `x`.
  Prefer the named colours to hex: they stay readable in the dark theme.
- A font the person has not added leaves the text in its usual font.
- **Which style wins:** a span over a block line, a block line over the note's front matter.
  Only what the stronger one sets is replaced; the rest is kept.

### Details of plain Markdown that matter

- **Paragraphs and lines.** An empty line ends a paragraph. A single line break inside a
  paragraph is not shown as one: end a line with a backslash (`\`) to break the line there.
- **Lists inside lists.** Indent the inner item under the text of the outer one: two spaces
  under a `- ` item, three under a `1. ` item. A task is a bullet whose text starts `[ ] ` or
  `[x] `.
- **Tables.** The first row is the header. The second row sets how each column is lined up:
  `:--` left, `--:` right, `:-:` centred. Each row is one line: a cell cannot hold a line
  break, a list or a code block. Text in a cell can be bold, a link, or a styled span. Write
  `\|` for a bar inside a cell.
- **Code.** Nothing is styled inside inline code or a code block: there, every character is
  shown as typed.
- **Links.** `http://`, `https://` and `mailto:` addresses open; a link to anything else is
  shown but does not open.
- **To show a character that would otherwise be read:** put a backslash before it, as in
  `\*`, `\#`, `\[`, `\]`, `\{`, `\}`, `\+`, `\=` and `\|`.
- **A horizontal line and the top of the note.** A note that begins with `---` is read as
  beginning with front matter when a second `---` line follows. Do not start the body of a
  note that has no front matter with a horizontal line.

### What you cannot put in a note

- **Photos.** You cannot add one. A person's photo is a line such as
  `![Tram 28](note.assets/tram.jpg)`, often with `{width=70%}` on the line under it for its
  width: keep both exactly as they are. A picture from a web address
  (`![x](https://example.com/a.png)`) is not shown, only its description.
- **HTML.** It is not read: `<b>x</b>` and `<br>` are shown as typed.
- **Drawings inside a note, footnotes, mathematics and embedded pages:** there are none. Make a
  drawing as its own item and give its `url` in the note as a link.

## Read

```sh
curl -sS "{{SERVER}}/api/agent/v1/items/$ID" -H "Authorization: Bearer $NOOK_TOKEN"
```

Answer: `{ "text": "…", "revision": "…", "entry": { … }, "url": "…" }`. `text` is the whole
document, front matter included. `revision` is what you need to save.

To get the document as a file, with its revision in the `ETag` header:

```sh
curl -sS "{{SERVER}}/api/agent/v1/items/$ID/text" -H "Authorization: Bearer $NOOK_TOKEN" -o note.md -D headers.txt
```

## Change an item

Read it, change the text, and send **the whole document** back with the revision you read:

```sh
curl -sS -X PUT "{{SERVER}}/api/agent/v1/items/$ID" -H "Authorization: Bearer $NOOK_TOKEN" -H "Content-Type: text/markdown" -H "If-Match: $REVISION" --data-binary @note.md
```

Answer: `{ "revision": "…", "entry": { … }, "url": "…" }`. Use the new revision for your next
save.

- Keep the front matter. To change the title or tags, change them there.
- Keep lines such as `![](note.assets/photo.jpg)` exactly as they are: they are the note's
  photos, which you cannot open.
- **409 `changed`**: someone saved since you read. The answer has `current` (`text`,
  `revision`, `entry`). Make your change again on `current.text` and save with
  `current.revision`. Never send your old text with the new revision: that undoes their work.
- You cannot save a note empty (422 `empty`).

## Add to the end of a note

For a log, a list or a journal, append. It needs no revision and replaces none of the note's
text. (It does tidy the very end: spaces, tabs and empty lines after the last line of the note
are removed before the new text is added. If those matter, save the whole document.)

```sh
curl -sS -X POST "{{SERVER}}/api/agent/v1/items/$ID/append" -H "Authorization: Bearer $NOOK_TOKEN" -H "Content-Type: text/markdown" --data-binary '- olive oil'
```

Answer: as a save. The text goes after the note's existing text, with one empty line between
them (straight after the front matter when the note has no text yet).

If the answer to an append is lost, **read the note before you send it again**, or the text is
added twice. Or send `If-Match` with the revision you read: then a second try is refused with
409 if the first one arrived.

## Undo: history

A save that changes the document keeps the text it replaced, as a version (a save of the same
bytes writes nothing). To undo a save, read the old version and save
its text. Do it soon: of the texts that agents wrote, only the newest 10 of a note and 5 of a
drawing are kept, so your eleventh save of a note removes the oldest of them. The texts a
person wrote are not removed by anything you do.

```sh
curl -sS "{{SERVER}}/api/agent/v1/items/$ID/history" -H "Authorization: Bearer $NOOK_TOKEN"
```

Answer: `{ "versions": [ { "version": "…", "time": "…", "size": 123, "agent": null } ] }`, newest
first. `agent` is the name of the agent that wrote that text, or `null` for a person.

```sh
curl -sS "{{SERVER}}/api/agent/v1/items/$ID/history/$VERSION" -H "Authorization: Bearer $NOOK_TOKEN"
```

Answer: `{ "text": "…" }`.

## Drawings

A drawing is an Excalidraw file. To make one, start from this complete example (two boxes with
labels, a line of text, and an arrow from one box to the other), save it as
`drawing.excalidraw`, and change it:

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "nook",
  "elements": [
    { "id": "box-a", "type": "rectangle", "x": 0, "y": 0, "width": 180, "height": 80, "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "solid", "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100, "groupIds": [], "frameId": null, "index": "a0", "roundness": { "type": 3 }, "seed": 101, "version": 1, "versionNonce": 201, "isDeleted": false, "boundElements": [ { "type": "text", "id": "label-a" }, { "type": "arrow", "id": "arrow-ab" } ], "updated": 1, "link": null, "locked": false },
    { "id": "label-a", "type": "text", "x": 50, "y": 27.5, "width": 80, "height": 25, "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "solid", "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100, "groupIds": [], "frameId": null, "index": "a1", "roundness": null, "seed": 102, "version": 1, "versionNonce": 202, "isDeleted": false, "boundElements": [], "updated": 1, "link": null, "locked": false, "text": "Browser", "fontSize": 20, "fontFamily": 5, "textAlign": "center", "verticalAlign": "middle", "containerId": "box-a", "originalText": "Browser", "autoResize": true, "lineHeight": 1.25 },
    { "id": "box-b", "type": "rectangle", "x": 360, "y": 0, "width": 180, "height": 80, "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "#ffec99", "fillStyle": "solid", "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100, "groupIds": [], "frameId": null, "index": "a2", "roundness": { "type": 3 }, "seed": 103, "version": 1, "versionNonce": 203, "isDeleted": false, "boundElements": [ { "type": "text", "id": "label-b" }, { "type": "arrow", "id": "arrow-ab" } ], "updated": 1, "link": null, "locked": false },
    { "id": "label-b", "type": "text", "x": 415, "y": 27.5, "width": 70, "height": 25, "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "solid", "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100, "groupIds": [], "frameId": null, "index": "a3", "roundness": null, "seed": 104, "version": 1, "versionNonce": 204, "isDeleted": false, "boundElements": [], "updated": 1, "link": null, "locked": false, "text": "Server", "fontSize": 20, "fontFamily": 5, "textAlign": "center", "verticalAlign": "middle", "containerId": "box-b", "originalText": "Server", "autoResize": true, "lineHeight": 1.25 },
    { "id": "arrow-ab", "type": "arrow", "x": 190, "y": 40, "width": 160, "height": 0, "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "solid", "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100, "groupIds": [], "frameId": null, "index": "a4", "roundness": { "type": 2 }, "seed": 105, "version": 1, "versionNonce": 205, "isDeleted": false, "boundElements": [], "updated": 1, "link": null, "locked": false, "points": [ [0, 0], [160, 0] ], "lastCommittedPoint": null, "startBinding": { "elementId": "box-a", "focus": 0, "gap": 10 }, "endBinding": { "elementId": "box-b", "focus": 0, "gap": 10 }, "startArrowhead": null, "endArrowhead": "arrow", "elbowed": false },
    { "id": "note-1", "type": "text", "x": 0, "y": 130, "width": 260, "height": 25, "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "solid", "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100, "groupIds": [], "frameId": null, "index": "a5", "roundness": null, "seed": 106, "version": 1, "versionNonce": 206, "isDeleted": false, "boundElements": [], "updated": 1, "link": null, "locked": false, "text": "One save, whole document", "fontSize": 20, "fontFamily": 5, "textAlign": "left", "verticalAlign": "top", "containerId": null, "originalText": "One save, whole document", "autoResize": true, "lineHeight": 1.25 }
  ],
  "appState": { "viewBackgroundColor": "#ffffff" },
  "files": {}
}
```

```sh
curl -sS -X POST "{{SERVER}}/api/agent/v1/items?title=Architecture&tags=work" -H "Authorization: Bearer $NOOK_TOKEN" -H "Content-Type: application/vnd.excalidraw+json" --data-binary @drawing.excalidraw
```

The rules that keep a drawing whole:

- Every element has its own `id`; `x` and `y` are its top left, in pixels, with y downward.
- **A label in a box** is a `text` element whose `containerId` is the box's `id`, and the box
  names it in `boundElements` as `{ "type": "text", "id": … }`. Put the text inside the box.
- **An arrow between two boxes** has `startBinding` and `endBinding` with each box's `id`, and
  each box names the arrow in `boundElements` as `{ "type": "arrow", "id": … }`. Its `x` and
  `y` are where it starts; `points` are relative to that, the first always `[0, 0]`; `width`
  and `height` are the extent of the points.
- Give each element a different `seed`, `versionNonce` and `index` (`a0`, `a1`, `a2`, … in the
  order they are drawn).
- A text's `width` is about 11 pixels a character at `fontSize` 20, and its `height` 25 a line.
  Nothing measures it for you: the sizes stay as you write them until a person edits that
  text, so leave a label room inside its box.

To change a drawing, read it, change the JSON, and save **all of it** with `PUT`, as for a
note, with `Content-Type: application/vnd.excalidraw+json`. Keep `files` whole: it holds the
drawing's images, and a save that drops one an element uses is refused (422 `missing-image`).
Keep the `nook` key: it holds the title, tags and date. A drawing with images can be many
megabytes. You cannot append to a drawing, or save one with no elements (422 `empty`).

## Errors

Every error is JSON, and `hint` says what to do next:

```json
{ "error": { "code": "changed", "message": "The note was changed since you opened it.", "hint": "Read the item again, apply your change to the new text, and save with the new revision." } }
```

| Status | Code | What happened | What to do |
|---|---|---|---|
| 400 | `bad-request` | The address, a header or a value is wrong | Read the hint; compare with the example here |
| 401 | `no-token` | No token, or one that is revoked or unknown | Ask your person for a token |
| 404 | `not-found` | No such item, version or route | Check the id; list to find it |
| 409 | `changed` | The item was saved since you read it | Redo your change on `current.text`, save with `current.revision` |
| 410 | `trashed` | A person moved the item to the trash | Tell your person; you cannot bring it back |
| 413 | `too-large` | Over 2 MB for a note, 25 MB for a drawing | Send less |
| 415 | `unsupported-type` | No `Content-Type`, or not the item's kind | Send the type from the table above |
| 422 | `not-utf8`, `not-json`, `not-excalidraw`, `refused` | The document cannot be read | Send valid UTF-8; for a drawing, valid JSON with `type` and `elements` |
| 422 | `broken-front-matter` | The front matter is not valid YAML | Mend what you sent; if the note already had it, tell your person |
| 422 | `bad-tag`, `bad-title` | A tag or the title in the address is not acceptable | A tag is lower-case letters only; a title is at most 300 characters |
| 422 | `empty` | A save would empty the item; or an append had no text | For a save, send the whole document you want. For an append, send only the text to add, never the whole note |
| 422 | `missing-image` | The save would drop an image of a drawing | Read again and send `files` whole |
| 428 | `no-revision` | A save without `If-Match` | Read the item and send its revision |
| 429 | `busy` | More than 60 changes a minute or 300 MB a day for this person | Wait as the hint says |
| 500, 503 | `server`, `unavailable` | The server failed | A save may or may not have been made: read the item before sending again |
