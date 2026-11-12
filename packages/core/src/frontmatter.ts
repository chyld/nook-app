// Broken front matter (SPEC2 4.4), ported from version 1's `shared/idwriter.ts` (only this
// function: version 2 writes no id).

import { type YamlNode } from "../../../noteformat/src/index.ts";
import { splitLines } from "../../../noteformat/src/source.ts";
import { parseYaml } from "../../../noteformat/src/yaml.ts";

const FENCE = /^--- *$/;

function isBlank(line: string): boolean {
  return /^[ \t]*$/.test(line);
}

/**
 * A file has broken front matter if its first line is `---`, a later line is `---`, and the
 * lines between are not blank and do not parse as a YAML mapping. "A later line" is the first
 * such line, the closing line of the format. A mapping with no keys (`{}`) is not broken.
 */
export function hasBrokenFrontMatter(text: string): boolean {
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const lines = splitLines(text, start);
  if (lines.length < 2 || !FENCE.test(text.slice(lines[0].start, lines[0].end))) return false;
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (FENCE.test(text.slice(lines[i].start, lines[i].end))) {
      close = i;
      break;
    }
  }
  if (close < 0) return false;
  const inner = lines.slice(1, close).map((l) => text.slice(l.start, l.end));
  if (inner.every(isBlank)) return false;
  let node: YamlNode | null = null;
  try {
    node = parseYaml(inner.join("\n"));
  } catch {
    return true;
  }
  return !(node && node.kind === "map");
}
