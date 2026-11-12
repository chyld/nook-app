// parseNote(): the parse order of SPEC 5, steps 1 to 4.

import { applyBlockAttributes } from "./blockattrs.ts";
import { linesInput, normalizeLabel, parseBlocks } from "./blocks.ts";
import { readFrontMatter } from "./frontmatter.ts";
import { parseInline, type LookupDefinition } from "./inline/index.ts";
import { makeBodyText } from "./source.ts";
import type { Note } from "./types.ts";
import type { Definition } from "./inline/items.ts";

export function parseNote(source: string): Note {
  // SPEC 2: a byte order mark at the start is ignored.
  const bom = source.charCodeAt(0) === 0xfeff;
  const start = bom ? 1 : 0;

  // Step 1: front matter is separated from the body (SPEC 3).
  const frontMatter = readFrontMatter(source, start);
  const bodyStart = frontMatter ? frontMatter.range.end : start;
  const body = makeBodyText(source, bodyStart, source.length);

  // Step 2: the body is divided into blocks.
  const blocks = parseBlocks(body);
  const definitions = new Map<string, Definition>();
  for (const d of blocks.definitions) {
    if (!definitions.has(d.label)) {
      definitions.set(d.label, {
        destination: d.destination,
        title: d.title,
        label: d.label,
        destinationRange: d.destinationRange,
      });
    }
  }
  const lookup: LookupDefinition = (label) => {
    if (label.length > 999) return null;
    const key = normalizeLabel(label);
    return key === "" ? null : (definitions.get(key) ?? null);
  };

  // Step 3: block attribute lines are identified among the finished blocks.
  applyBlockAttributes(body, blocks, lookup);

  // Step 4: the inline text of each block is parsed.
  for (const job of blocks.jobs) {
    if ("lines" in job) {
      const input = linesInput(body, job.lines);
      job.node.children = parseInline(input, lookup);
      const n = input.text.length;
      job.node.contentRange = { start: input.offsets[0], end: input.offsets[n] };
    } else {
      job.node.children = parseInline(job.input, lookup);
    }
  }

  return {
    type: "note",
    bom,
    frontMatter,
    bodyRange: { start: bodyStart, end: source.length },
    children: blocks.children,
    definitions: blocks.definitions,
    range: { start: 0, end: source.length },
  };
}
