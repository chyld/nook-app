// The syntax tree produced by parseNote().
//
// Every node carries `range`: start and end offsets into the original source string, exactly as
// it was passed to parseNote(), including any byte order mark and CRLF line endings. `start` is
// inclusive and `end` is exclusive, as in String.prototype.slice.

export interface Range {
  start: number;
  end: number;
}

// ---------------------------------------------------------------------------------------------
// Attribute lists (SPEC 5.3)

export interface Attribute {
  key: string;
  /** The value after quotes are removed and escapes are resolved (SPEC 5.3). */
  value: string;
  /** True when the value was written as a quoted string. */
  quoted: boolean;
  range: Range;
}

export interface AttributeList {
  type: "attributeList";
  /** Every attribute as written, in order, including unknown or invalid ones. */
  attributes: Attribute[];
  range: Range;
}

/** Where an attribute list applies; decides which keys are allowed (SPEC 5.3 table). */
export type AttributePlace = "span" | "paragraph" | "heading" | "image";

/** The attributes that apply after validation (SPEC 5.3): last valid occurrence of each key. */
export interface ResolvedStyle {
  color?: string;
  bg?: string;
  font?: string;
  size?: string;
  underline?: "yes" | "no";
  width?: string;
}

// ---------------------------------------------------------------------------------------------
// Front matter (SPEC 3)

export type YamlNode = YamlScalar | YamlSequence | YamlMapping;

export interface YamlScalar {
  kind: "scalar";
  /** The scalar's text without quotes; never converted to a number, boolean or null. */
  value: string;
  style: "plain" | "single" | "double" | "literal" | "folded";
}

export interface YamlSequence {
  kind: "seq";
  items: YamlNode[];
}

export interface YamlMapping {
  kind: "map";
  entries: { key: string; value: YamlNode }[];
}

export interface FrontMatter {
  type: "frontMatter";
  /** From the start of the opening `---` line to the end of the closing line's line ending. */
  range: Range;
  /** The YAML text between the two `---` lines. */
  contentRange: Range;
  /** The parsed mapping, every key in order, duplicates included. */
  mapping: YamlMapping;
  /** The known keys of SPEC 3 that hold a valid value (last occurrence of a key is used). */
  fields: FrontMatterFields;
}

export interface FrontMatterFields {
  /** SPEC 1.1: 12 characters from `a-z` and `2-7`; absent when missing or invalid. */
  id?: string;
  title?: string;
  tags?: string[];
  created?: string;
  updated?: string;
  font?: string;
  size?: string;
  theme?: string;
}

// ---------------------------------------------------------------------------------------------
// Blocks (SPEC 4, step 2 of the parse order)

export type Block =
  | Paragraph
  | Heading
  | BlockQuote
  | List
  | CodeBlock
  | ThematicBreak
  | Table;

/** A block attribute line (SPEC 5.4) that was recognised and applied to a block. */
export interface BlockAttributes {
  type: "blockAttributes";
  /** What the line applies to: the heading above it, the paragraph it ends, or its image. */
  target: "heading" | "paragraph" | "image";
  list: AttributeList;
  /** The whole line, spaces included, without its line ending. */
  range: Range;
}

export interface Paragraph {
  type: "paragraph";
  children: Inline[];
  /** True when the paragraph is in a tight list and renders without <p>. */
  tight: boolean;
  /** Set when the paragraph's last line is a block attribute line (paragraph or image case). */
  attributes?: BlockAttributes;
  /** Range of the inline text (without a block attribute line or task marker). */
  contentRange: Range;
  range: Range;
}

export interface Heading {
  type: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  setext: boolean;
  children: Inline[];
  /** Set when the line below is a block attribute line (heading case). */
  attributes?: BlockAttributes;
  contentRange: Range;
  range: Range;
}

export interface BlockQuote {
  type: "blockQuote";
  children: Block[];
  range: Range;
}

export interface List {
  type: "list";
  ordered: boolean;
  /** The start number of an ordered list. */
  start: number;
  /** `-`, `+` or `*` for a bullet list; `.` or `)` for an ordered list. */
  marker: string;
  tight: boolean;
  children: ListItem[];
  range: Range;
}

export interface ListItem {
  type: "listItem";
  /** Set when the item starts with a task list marker (SPEC 5.1, last bullet). */
  task?: { checked: boolean; range: Range };
  children: Block[];
  range: Range;
}

export interface CodeBlock {
  type: "codeBlock";
  fenced: boolean;
  /** The info string of a fenced block, with escapes and entities resolved. */
  info: string;
  /** The first word of the info string, or "" (used for class="language-…"). */
  language: string;
  value: string;
  range: Range;
}

export interface ThematicBreak {
  type: "thematicBreak";
  range: Range;
}

export type Alignment = "left" | "center" | "right" | null;

export interface Table {
  type: "table";
  align: Alignment[];
  head: TableRow;
  body: TableRow[];
  range: Range;
}

export interface TableRow {
  type: "tableRow";
  cells: TableCell[];
  range: Range;
}

export interface TableCell {
  type: "tableCell";
  children: Inline[];
  /** Range of the cell's text between its pipes, trimmed; empty for a missing cell. */
  range: Range;
}

// ---------------------------------------------------------------------------------------------
// Inline nodes (SPEC 5, step 4 of the parse order)

export type Inline =
  | Text
  | SoftBreak
  | HardBreak
  | Code
  | Emphasis
  | Strong
  | Strikethrough
  | Link
  | Image
  | StyledSpan
  | Underline
  | Highlight;

export interface Text {
  type: "text";
  /**
   * The text with backslash escapes and entity references resolved (the text of a bare URL link
   * is the URL as written, with nothing resolved).
   */
  value: string;
  range: Range;
}

export interface SoftBreak {
  type: "softBreak";
  range: Range;
}

export interface HardBreak {
  type: "hardBreak";
  range: Range;
}

export interface Code {
  type: "code";
  value: string;
  range: Range;
}

export interface Emphasis {
  type: "emphasis";
  children: Inline[];
  range: Range;
}

export interface Strong {
  type: "strong";
  children: Inline[];
  range: Range;
}

export interface Strikethrough {
  type: "strikethrough";
  children: Inline[];
  range: Range;
}

export interface Link {
  type: "link";
  /**
   * inline: `[text](url)`; reference: full, collapsed or shortcut reference; autolink:
   * `<https://…>` (CommonMark); bare: a GFM extended autolink found by the bare URL pass.
   */
  kind: "inline" | "reference" | "autolink" | "bare";
  /**
   * The destination: for inline and reference links with escapes and entities resolved; for a
   * bare URL its text as written (nothing decoded), with `http://` before `www.` and `mailto:`
   * before an email address; for an email autolink with `mailto:` before it.
   */
  destination: string;
  title: string | null;
  children: Inline[];
  range: Range;
}

export interface Image {
  type: "image";
  kind: "inline" | "reference";
  /** The destination as CommonMark gives it (escapes and entities resolved, not %-decoded). */
  destination: string;
  title: string | null;
  /** The description, an inline scope of its own. */
  children: Inline[];
  /** The plain text of the description, used as alt text. */
  alt: string;
  /**
   * Where the destination is written in the source, angle brackets included when it has them
   * (empty for `![a]()`). For a reference image this is the destination in the link reference
   * definition the image uses, so several images can share one range.
   */
  destinationRange: Range;
  /** For a reference image: the normalised label of the definition it uses. */
  label?: string;
  range: Range;
}

export interface StyledSpan {
  type: "span";
  attributes: AttributeList;
  children: Inline[];
  range: Range;
}

/** `++text++` (SPEC 5.2). */
export interface Underline {
  type: "underline";
  children: Inline[];
  range: Range;
}

/** `==text==` (SPEC 5.2). */
export interface Highlight {
  type: "highlight";
  children: Inline[];
  range: Range;
}

// ---------------------------------------------------------------------------------------------
// The note

export interface LinkDefinition {
  type: "definition";
  /** The label normalised as CommonMark matches labels. */
  label: string;
  destination: string;
  title: string | null;
  /** Where the destination is written in the source, angle brackets included. */
  destinationRange: Range;
  range: Range;
}

export interface Note {
  type: "note";
  /** True when the source starts with a UTF-8 byte order mark (U+FEFF), which is ignored. */
  bom: boolean;
  frontMatter: FrontMatter | null;
  /** The body: everything after the front matter (SPEC 2). */
  bodyRange: Range;
  children: Block[];
  /** Link reference definitions; the first definition of a label is the one used. */
  definitions: LinkDefinition[];
  range: Range;
}
