// SPEC-AGENTS 5.8: what an agent should do next. Every answer of status 400 or above on an agent
// address has a hint inside `error`. A handler that knows the value at fault gives its own; this
// is the general hint for a code, used when it gave none.

import { DRAWING_TYPE, LIMITS, MB, PATTERNS } from "../../contract/src/index.ts";

/** `guide`: the full address of the guide (5.1). */
export function hintFor(status: number, code: string, guide: string): string {
  switch (code) {
    case "no-token":
      return `Send the token a person made for you on Nook's Account screen as the header "Authorization: Bearer nook_…". The guide is at ${guide} and needs no token.`;
    case "not-found":
      return `Check the id or the address. Every route an agent has is listed in the guide at ${guide}; there is no route to delete, trash or restore, or for photos.`;
    case "changed":
      return "Read the item again, apply your change to the new text, and save with the new revision.";
    case "trashed":
      return "A person moved this item to the trash. Only a person can bring it back; an agent cannot.";
    case "too-large":
      return `A note may be at most ${LIMITS.noteBytes / MB} MB and a drawing at most ${LIMITS.drawingBytes / MB} MB. Send a smaller document.`;
    case "unsupported-type":
      return `Send a Content-Type header: text/markdown for a note, ${DRAWING_TYPE} for a drawing, and the one that is the item's kind when you save. With curl, add -H "Content-Type: text/markdown" and use --data-binary.`;
    case "not-utf8":
      return "Send the document as UTF-8 text.";
    case "not-json":
      return "A drawing is one JSON object. Check that the body is valid JSON and was not cut short.";
    case "not-excalidraw":
      return `A drawing needs "type": "excalidraw" and an "elements" array at the top level. The guide at ${guide} has a complete example.`;
    case "broken-front-matter":
      return "The lines between the two --- lines at the top of the note are not valid YAML. If you sent them, mend them; if the note already had them, a person must mend the note in the app.";
    case "bad-tag":
      return `A tag is 1 to 30 lower-case letters a to z (${PATTERNS.tag}): no digits, hyphens or spaces.`;
    case "bad-title":
      return `A title is at most ${LIMITS.titleMax} characters, without control characters.`;
    case "empty":
      return "An agent cannot empty a note or a drawing. Send the whole document you want it to have.";
    case "missing-image":
      return 'Read the drawing again and send its whole "files" back with your change.';
    case "no-revision":
      return 'A save needs the header "If-Match: <revision>", with the revision you got when you read the item. Read it first; to add to a note without one, use append.';
    case "busy":
      return "Wait a minute, then send the request again.";
    case "bad-request":
      return `The address, a header or a value does not have the form this route takes. The guide at ${guide} shows each route with an example.`;
    case "refused":
      return "The document or a value in the request is not acceptable; the message says which.";
    default:
      if (status >= 500) return "Something failed on the server. A save may or may not have been made: read the item before you send it again.";
      return `See the guide at ${guide}.`;
  }
}
