// Rich mode's widgets as checked edits (EDITOR-PLAN 3.5).

import { test } from "node:test";
import assert from "node:assert/strict";
import { linkAt, setImageWidth, toggleTask } from "../src/style/widgets.ts";

test("photo width: edit the image's attribute line, or add one", () => {
  const ok = (r: ReturnType<typeof setImageWidth>) => {
    assert.ok(r.ok, r.ok ? "" : r.reason);
    return r.text;
  };
  assert.equal(ok(setImageWidth("Text\n\n![Tram](<a.jpg>)\n{width=70%}\n\nMore", 4, "25%")), "Text\n\n![Tram](<a.jpg>)\n{width=25%}\n\nMore");
  assert.equal(ok(setImageWidth("![Tram](a.jpg)\n\nMore", 0, "50%")), "![Tram](a.jpg)\n{width=50%}\n\nMore");
  assert.equal(ok(setImageWidth("![Tram](a.jpg)", 0, "100%")), "![Tram](a.jpg)\n{width=100%}");
  assert.equal(ok(setImageWidth("![Tram](a.jpg)\n# Next", 0, "75%")), "![Tram](a.jpg)\n{width=75%}\n\n# Next");
  assert.deepEqual(setImageWidth("See ![Tram](a.jpg) here", 4, "50%"), { ok: false, reason: "a width is set on a photo on a line of its own" });
});

test("task checkbox: [ ] and [x] change, nothing else", () => {
  const r = toggleTask("- [ ] one\n- [x] two\n", 3);
  assert.ok(r.ok);
  assert.equal(r.text, "- [x] one\n- [x] two\n");
  const r2 = toggleTask(r.text, 12);
  assert.ok(r2.ok);
  assert.equal(r2.text, "- [x] one\n- [ ] two\n");
  assert.equal(toggleTask("- plain\n", 2).ok, false);
});

test("the link around a position", () => {
  const t = "see [the **guide**](https://a.example) now";
  assert.deepEqual(linkAt(t, 12), { from: 5, to: 16, url: "https://a.example" });
  assert.equal(linkAt(t, 1), null);
});
