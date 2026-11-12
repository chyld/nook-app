// SPEC 5 step 3 and SPEC 5.4: block attribute lines are identified among the finished blocks.

import { hasAllowedKey, parseAttributeList } from "./attributes.ts";
import { linesInput, type BlockResult, type InlineJob } from "./blocks.ts";
import { parseInline, type LookupDefinition } from "./inline/index.ts";
import { isBlankText, sourceRange, type BodyText } from "./source.ts";
import type { AttributePlace, BlockAttributes, Heading, Paragraph } from "./types.ts";

/**
 * Looks at every paragraph that is a direct child of the document. A block attribute line is
 * always the last line of such a paragraph: under a heading it is a paragraph of one line.
 * Recognised lines are attached to their block and taken out of the block's inline text.
 */
export function applyBlockAttributes(body: BodyText, result: BlockResult, lookup: LookupDefinition): void {
  const lineText = (l: number) => body.text.slice(body.lines[l].start, body.lines[l].end);
  const children = result.children;
  const removed = new Set<InlineJob>();
  const jobOf = new Map<unknown, InlineJob>();
  for (const j of result.jobs) jobOf.set(j.node, j);
  for (let idx = 0; idx < children.length; idx++) {
    const para = children[idx];
    if (para.type !== "paragraph") continue;
    const span = result.lineSpans.get(para);
    const job = jobOf.get(para) as { node: Paragraph; lines: [number, number][] } | undefined;
    if (!span || !job) continue;
    const [l0, l1] = span;
    const last = l1 - 1;
    const text = lineText(last);

    // 1. The line contains an attribute list and nothing else except optional spaces around it.
    let lead = 0;
    while (text[lead] === " ") lead++;
    const list = parseAttributeList(text, lead);
    if (!list || !/^ *$/.test(text.slice(list.end))) continue;
    // 2. The line after it is blank, or it is the last line of the file.
    if (last + 1 < body.lines.length && !isBlankText(lineText(last + 1))) continue;
    // 3. The line before it is not blank.
    if (last === 0 || isBlankText(lineText(last - 1))) continue;

    // 5. Heading, image or paragraph, tested in this order.
    let target: BlockAttributes["target"];
    const prev = children[idx - 1];
    const prevSpan = prev ? result.lineSpans.get(prev) : undefined;
    if (l1 - l0 === 1 && prev?.type === "heading" && !prev.setext && prevSpan && prevSpan[1] - 1 === last - 1) {
      target = "heading";
    } else if (l1 - l0 >= 2) {
      const rest = parseInline(linesInput(body, job.lines.slice(0, -1)), lookup);
      target = rest.length === 1 && rest[0].type === "image" ? "image" : "paragraph";
    } else {
      continue;
    }
    // 4. At least one attribute has a key allowed for the block it would apply to.
    const place: AttributePlace = target;
    if (!hasAllowedKey(list.attributes, place)) continue;

    const lineStart = body.lines[last].start;
    const attributes: BlockAttributes = {
      type: "blockAttributes",
      target,
      list: {
        type: "attributeList",
        attributes: list.attributes.map((a) => ({
          key: a.key,
          value: a.value,
          quoted: a.quoted,
          range: sourceRange(body, lineStart + a.start, lineStart + a.end),
        })),
        range: sourceRange(body, lineStart + list.start, lineStart + list.end),
      },
      range: sourceRange(body, lineStart, body.lines[last].end),
    };
    if (target === "heading") {
      (prev as Heading).attributes = attributes;
      children.splice(idx, 1);
      removed.add(job);
      idx--;
    } else {
      // A block attribute line is not shown and is not part of the text of its block.
      para.attributes = attributes;
      job.lines = job.lines.slice(0, -1);
    }
  }
  if (removed.size > 0) result.jobs = result.jobs.filter((j) => !removed.has(j));
}
