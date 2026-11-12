// Helpers for tests and the editor: a selection given by visible text.

import { styleRuns } from "../../../../noteformat/src/index.ts";

/** The source range of the `nth` occurrence of `needle` in the visible text of `text`. */
export function selectVisible(text: string, needle: string, nth = 0): { from: number; to: number } {
  const chars = styleRuns(text).chars;
  const shown = chars.map((c) => c.ch).join("");
  let at = -1;
  for (let k = 0; k <= nth; k++) {
    at = shown.indexOf(needle, at + 1);
    if (at < 0) throw new Error(`"${needle}" is not in the visible text "${shown}"`);
  }
  return { from: chars[at].start, to: chars[at + needle.length - 1].end };
}
