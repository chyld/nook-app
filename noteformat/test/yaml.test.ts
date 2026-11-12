// The YAML reader behind SPEC 3 condition 3 (src/yaml.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYaml, YamlError } from "../src/yaml.ts";
import type { YamlNode } from "../src/index.ts";

/** A plain JavaScript view of a node: scalars as strings. */
function js(n: YamlNode | null): unknown {
  if (n === null) return null;
  if (n.kind === "scalar") return n.value;
  if (n.kind === "seq") return n.items.map(js);
  return n.entries.map((e) => [e.key, js(e.value)]);
}
const y = (s: string) => js(parseYaml(s));
const bad = (s: string) => assert.throws(() => parseYaml(s), YamlError, JSON.stringify(s));

test("yaml: block mappings, nested mappings and comments", () => {
  assert.deepEqual(y("a: 1\nb:\n  c: 2\n  d: x y  # comment\n# whole line\ne: 3"), [["a", "1"], ["b", [["c", "2"], ["d", "x y"]]], ["e", "3"]]);
});

test("yaml: duplicate keys are kept in order", () => {
  assert.deepEqual(y("a: 1\na: 2"), [["a", "1"], ["a", "2"]]);
});

test("yaml: block sequences, also at the indentation of their key, and compact mappings", () => {
  assert.deepEqual(y("t:\n  - a\n  - b"), [["t", ["a", "b"]]]);
  assert.deepEqual(y("t:\n- a\n- b\nu: c"), [["t", ["a", "b"]], ["u", "c"]]);
  assert.deepEqual(y("t:\n  - k: v\n    l: w\n  - - x\n    - y"), [["t", [[["k", "v"], ["l", "w"]], ["x", "y"]]]]);
});

test("yaml: flow sequences and mappings, over several lines", () => {
  assert.deepEqual(y("t: [a, 'b c', \"d\", [e]]"), [["t", ["a", "b c", "d", ["e"]]]]);
  assert.deepEqual(y("t: [a,\n  b,\n]\nm: {x: 1, y: [2, 3], z}"), [["t", ["a", "b"]], ["m", [["x", "1"], ["y", ["2", "3"]], ["z", ""]]]]);
  assert.deepEqual(y("t: [http://a.example/x, a:b]"), [["t", ["http://a.example/x", "a:b"]]]);
});

test("yaml: plain scalars keep their text: no conversion of numbers, booleans or null", () => {
  assert.deepEqual(y("a: true\nb: 1.50\nc: ~\nd: null\ne: 0x1F"), [["a", "true"], ["b", "1.50"], ["c", "~"], ["d", "null"], ["e", "0x1F"]]);
});

test("yaml: multi-line plain scalars fold", () => {
  assert.deepEqual(y("a: one\n  two\n\n  three\nb: x"), [["a", "one two\nthree"], ["b", "x"]]);
});

test("yaml: quoted scalars, escapes and folding", () => {
  assert.deepEqual(y("a: 'it''s'\nb: \"tab\\there \\u00e9 \\\"q\\\"\"\nc: \"one\n  two\""), [["a", "it's"], ["b", 'tab\there é "q"'], ["c", "one two"]]);
});

test("yaml: literal and folded block scalars with chomping", () => {
  assert.deepEqual(y("a: |\n  one\n  two\nb: >\n  one\n  two\n\n  three\nc: |-\n  x\nd: |+\n  x\n\ne: end"), [
    ["a", "one\ntwo\n"],
    ["b", "one two\nthree\n"],
    ["c", "x"],
    ["d", "x\n\n"],
    ["e", "end"],
  ]);
});

test("yaml: anchors, aliases and tags", () => {
  assert.deepEqual(y("a: &x hello\nb: *x\nc: !!str 12"), [["a", "hello"], ["b", "hello"], ["c", "12"]]);
});

test("yaml: an empty document", () => {
  assert.equal(parseYaml(""), null);
  assert.equal(parseYaml("# only a comment\n\n"), null);
});

test("yaml: invalid documents are errors", () => {
  bad("a: b: c");
  bad("a: [b");
  bad("a: 'b");
  bad("\ta: b");
  bad("a: 1\n  b: 2");
  bad("a:\n  - b\n  c: d");
  bad("a: *nope");
  bad("a: \"\\q\"");
  bad("- a\nb: c");
});

test("yaml: nesting deeper than MAX_YAML_DEPTH is an error, not a crash", () => {
  bad("a: " + "[".repeat(15000) + "]".repeat(15000));
  bad("a: " + "{b: ".repeat(15000) + "}".repeat(15000));
  bad(Array.from({ length: 3000 }, (_, i) => " ".repeat(i) + "a:").join("\n"));
  assert.deepEqual(y("a: [[[x]]]"), [["a", [[["x"]]]]]);
});

test("yaml: features outside the supported subset are errors (README Known gaps)", () => {
  bad("? a\n: b");
  bad("[a]: b");
  bad("%YAML 1.2\na: b");
  bad("a: b\n...\n");
});
