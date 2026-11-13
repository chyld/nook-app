// SPEC-DRAWINGS 8, `core`: serializeDrawing gives the same bytes for the same scene, leaves out
// deleted elements, unused images and the view; drawingFacts reads each value of `nook` right,
// wrong and missing, prefers `originalText` to `text`, and copes with text that is not JSON.

import { test } from "node:test";
import assert from "node:assert/strict";
import { drawingFacts, drawingProblem, drawingSignature, emptyDrawing, nookOf, parseDrawing, serializeDrawing } from "../src/index.ts";

const rect = (id: string, version = 1, extra: Record<string, unknown> = {}) => ({ type: "rectangle", id, version, x: 10, y: 20, width: 30, height: 40, isDeleted: false, ...extra });
const text = (id: string, t: string, extra: Record<string, unknown> = {}) => ({ type: "text", id, version: 1, text: t, isDeleted: false, ...extra });
const image = (id: string, fileId: string, extra: Record<string, unknown> = {}) => ({ type: "image", id, version: 1, fileId, status: "saved", isDeleted: false, ...extra });
const file = (id: string) => ({ id, mimeType: "image/png", dataURL: `data:image/png;base64,${id}`, created: 1 });
const nook = { title: "Plan", tags: ["work"], created: "2026-11-12" };

test("serializeDrawing: the same scene gives the same bytes, whatever the order of keys", () => {
  const a = serializeDrawing({ elements: [rect("r1"), text("t1", "hi")], appState: { viewBackgroundColor: "#fff", gridSize: 20 }, files: {} }, nook);
  const b = serializeDrawing(
    { elements: [{ y: 20, x: 10, version: 1, type: "rectangle", isDeleted: false, id: "r1", height: 40, width: 30 }, { text: "hi", isDeleted: false, id: "t1", version: 1, type: "text" }], appState: { gridSize: 20, viewBackgroundColor: "#fff" }, files: {} },
    { created: "2026-11-12", tags: ["work"], title: "Plan" },
  );
  assert.equal(a, b);
  assert.ok(a.endsWith("}\n") && !a.includes("\r"), "LF and a final line break");
  const doc = JSON.parse(a);
  assert.deepEqual(Object.keys(doc), ["type", "version", "source", "elements", "appState", "files", "nook"]);
  assert.deepEqual(Object.keys(doc.elements[0]), ["height", "id", "isDeleted", "type", "version", "width", "x", "y"], "an element's keys in alphabetical order");
  assert.equal(doc.type, "excalidraw");
  assert.equal(doc.version, 2);
  assert.equal(doc.source, "nook");
  assert.deepEqual(doc.nook, nook);
  assert.ok(a.startsWith('{\n  "type": "excalidraw",\n'), "two-space indent");
});

test("serializeDrawing: deleted elements and unused images are left out; images by id in order", () => {
  const t = serializeDrawing(
    {
      elements: [image("i2", "fz"), rect("gone", 3, { isDeleted: true }), image("i1", "fa"), image("i3", "fdel", { isDeleted: true })],
      appState: { viewBackgroundColor: "#fff" },
      files: { fz: file("fz"), unused: file("unused"), fa: file("fa"), fdel: file("fdel") },
    },
    nook,
  );
  const doc = JSON.parse(t);
  assert.deepEqual(doc.elements.map((e: { id: string }) => e.id), ["i2", "i1"], "scene order, without the deleted");
  assert.deepEqual(Object.keys(doc.files), ["fa", "fz"], "only used images, by id");
  assert.deepEqual(doc.files.fa, file("fa"), "each image as given");
});

test("serializeDrawing: the view position, zoom, selection and tool are not in it", () => {
  const t = serializeDrawing(
    {
      elements: [],
      appState: { viewBackgroundColor: "#123456", gridSize: 20, gridStep: 5, gridModeEnabled: true, scrollX: 100, scrollY: -40, zoom: { value: 2 }, selectedElementIds: { a: true }, activeTool: { type: "rectangle" }, theme: "dark" },
      files: {},
    },
    nook,
  );
  assert.deepEqual(JSON.parse(t).appState, { viewBackgroundColor: "#123456", gridSize: 20, gridStep: 5, gridModeEnabled: true });
  for (const k of ["scrollX", "scrollY", "zoom", "selectedElementIds", "activeTool", "theme"]) assert.ok(!t.includes(`"${k}"`), k);
});

test("serializeDrawing: no created date in the file when there is none", () => {
  const doc = JSON.parse(serializeDrawing({ elements: [], appState: {}, files: {} }, { title: "x", tags: [], created: null }));
  assert.deepEqual(doc.nook, { title: "x", tags: [] });
});

test("emptyDrawing: the text a create writes", () => {
  assert.equal(
    emptyDrawing("Untitled 1", "2026-11-12"),
    '{\n  "type": "excalidraw",\n  "version": 2,\n  "source": "nook",\n  "elements": [],\n  "appState": {\n    "viewBackgroundColor": "#ffffff"\n  },\n  "files": {},\n  "nook": {\n    "title": "Untitled 1",\n    "tags": [],\n    "created": "2026-11-12"\n  }\n}\n',
  );
  assert.deepEqual(drawingFacts(emptyDrawing("Untitled 1", "2026-11-12")), { broken: false, title: "Untitled 1", tags: [], created: "2026-11-12", text: "" });
});

const withNook = (n: unknown, elements: unknown[] = []) => JSON.stringify({ type: "excalidraw", version: 2, elements, appState: {}, files: {}, nook: n });

test("drawingFacts: each value of nook right", () => {
  const f = drawingFacts(withNook({ title: "Garden", tags: ["home", "plants"], created: "2026-11-10" }));
  assert.deepEqual(f, { broken: false, title: "Garden", tags: ["home", "plants"], created: "2026-11-10", text: "" });
  assert.equal(drawingFacts(withNook({ created: "2026-11-10T09:30:00Z" })).created, "2026-11-10T09:30:00Z", "a date-time of the note format");
});

test("drawingFacts: each value of nook wrong is passed over, the others kept", () => {
  const f = drawingFacts(withNook({ title: 42, tags: ["ok", "Bad", 7, "two words", "x".repeat(31), "fine"], created: "2026-13-40" }));
  assert.deepEqual(f, { broken: false, title: "Untitled", tags: ["ok", "fine"], created: null, text: "" });
  assert.deepEqual(drawingFacts(withNook({ title: "T", tags: "work", created: 20261110 })), { broken: false, title: "T", tags: [], created: null, text: "" });
  assert.equal(drawingFacts(withNook({ title: "é".repeat(400) })).title, "é".repeat(300), "a title is cut to 300 characters");
  assert.equal(drawingFacts(withNook({ title: "   " })).title, "Untitled", "a blank title");
  assert.deepEqual(drawingFacts(withNook("not an object")), { broken: false, title: "Untitled", tags: [], created: null, text: "" });
  assert.deepEqual(drawingFacts(withNook([1, 2])).tags, []);
});

test("drawingFacts: nook missing (a file from excalidraw.com)", () => {
  const t = JSON.stringify({ type: "excalidraw", version: 2, source: "https://excalidraw.com", elements: [text("t", "hello")], appState: { viewBackgroundColor: "#fff" }, files: {} });
  assert.deepEqual(drawingFacts(t), { broken: false, title: "Untitled", tags: [], created: null, text: "hello" });
  assert.deepEqual(nookOf(parseDrawing(t).doc), { title: "", tags: [], created: null });
});

test("drawingFacts: the text is originalText before text, of text elements that are not deleted", () => {
  const f = drawingFacts(
    withNook({ title: "T" }, [
      text("a", "wrapped\nline", { originalText: "wrapped line" }),
      text("b", "only text"),
      text("c", "gone", { isDeleted: true, originalText: "gone too" }),
      rect("r", 1, { text: "not a text element" }),
      { type: "text", id: "d", text: 5, originalText: null },
      { type: "text", id: "e", originalText: "no text key" },
      "not an element",
    ]),
  );
  assert.equal(f.text, "wrapped line\nonly text\nno text key");
  assert.ok(!f.text.includes("{"), "never the JSON");
});

test("drawingFacts: text that is not JSON, or not a scene, never throws", () => {
  const broken = { broken: true, title: "Untitled", tags: [], created: null, text: "" };
  for (const t of ["", "not json", "{", "[]", "null", "42", '"excalidraw"', '{"type":"excalidraw"}', '{"type":"excalidraw","elements":{}}', '{"type":"other","elements":[]}', '{"elements":[]}']) {
    assert.deepEqual(drawingFacts(t), broken, JSON.stringify(t));
  }
  assert.equal(drawingProblem("not json"), "not-json");
  assert.equal(drawingProblem("[1]"), "not-json");
  assert.equal(drawingProblem('{"type":"excalidraw","elements":"x"}'), "not-excalidraw");
  assert.equal(drawingProblem('{"type":"excalidraw","elements":[]}'), null);
});

test("drawingSignature: element ids and versions, the kept app state, title and tags; not the view", () => {
  const els = [rect("a", 1), rect("b", 4), rect("c", 9, { isDeleted: true })];
  const s = drawingSignature(els, { viewBackgroundColor: "#fff", scrollX: 1 }, "T", ["x"]);
  assert.equal(s, drawingSignature([rect("a", 1, { x: 999 }), rect("b", 4)], { viewBackgroundColor: "#fff", scrollX: 500, zoom: { value: 3 } }, "T", ["x"]), "moving the view changes nothing");
  assert.notEqual(s, drawingSignature([rect("a", 2), rect("b", 4)], { viewBackgroundColor: "#fff" }, "T", ["x"]), "a version");
  assert.notEqual(s, drawingSignature(els, { viewBackgroundColor: "#000" }, "T", ["x"]), "the background");
  assert.notEqual(s, drawingSignature(els, { viewBackgroundColor: "#fff", gridModeEnabled: true }, "T", ["x"]), "the grid");
  assert.notEqual(s, drawingSignature(els, { viewBackgroundColor: "#fff" }, "U", ["x"]), "the title");
  assert.notEqual(s, drawingSignature(els, { viewBackgroundColor: "#fff" }, "T", []), "the tags");
  assert.notEqual(s, drawingSignature([rect("b", 4), rect("a", 1)], { viewBackgroundColor: "#fff" }, "T", ["x"]), "the order");
});
