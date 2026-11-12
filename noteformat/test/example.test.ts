// SPEC 9 Complete example, and the example files in examples/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderNote } from "../src/index.ts";
import { main } from "../src/cli.ts";

const specUrl = new URL("../../SPEC.md", import.meta.url);
const exampleUrl = new URL("../examples/lisbon-trip.md", import.meta.url);
const pageUrl = new URL("../examples/lisbon-trip.html", import.meta.url);

function specExample(): string {
  const spec = readFileSync(specUrl, "utf8");
  const start = spec.indexOf("````markdown\n") + "````markdown\n".length;
  const end = spec.indexOf("\n````\n", start);
  return spec.slice(start, end) + "\n";
}

const EXPECTED = `<h1 style="color: var(--note-indigo)">Lisbon trip</h1>
<h2>Plain Markdown</h2>
<p>A <strong>bold</strong> plan, an <em>italic</em> mood, <em><strong>both at once</strong></em>, and <del>a cancelled idea</del>.
Run <code>convert --eur</code> before paying. See <a href="https://example.com/lisbon">the city guide</a>.</p>
<blockquote>
<p>&quot;Saudade&quot; has no exact translation.
It is closer to a feeling than a word.</p>
</blockquote>
<hr>
<h2>The extras</h2>
<ul>
<li>Underline: <u>book by Friday</u></li>
<li>Underline as an attribute: <span style="text-decoration: underline">C++</span></li>
<li>Highlight: <mark>pack sunscreen</mark></li>
<li>Highlight in another colour: <span style="background-color: var(--note-mint)">window seat</span></li>
<li>Text colour: <span style="color: var(--note-red)">flight is delayed</span> or by hex <span style="color: #2b6cb0">like this</span></li>
<li>Font: <span style="font-family: 'Caveat'">a handwritten postcard line</span></li>
<li>Size: <span style="font-size: 0.875em">small print</span>, <span style="font-size: 1.25em">large</span>, <span style="font-size: 22px">exact</span></li>
<li>Combined: <span style="color: var(--note-white); background-color: var(--note-red); font-family: 'Inter'; font-size: 1.25em"><strong>Do not forget the passport</strong></span></li>
<li>Mixed: <strong>bold with a <span style="color: var(--note-red)">red word</span> inside</strong>, and <em>italic <u>underlined</u></em></li>
<li>Two fonts on one line: <span style="font-family: 'Playfair Display'">Playfair</span> beside <span style="font-family: var(--note-font-mono)">Mono</span></li>
<li>A styled link: <span style="color: var(--note-red)">see <a href="https://example.com">the guide</a></span></li>
<li>Plain brackets in a span: <span style="color: var(--note-gray)">see note [1] below</span></li>
</ul>
<p style="color: var(--note-gray); font-size: 0.875em">This whole paragraph is grey and small, set by the line below it.</p>
<h2>Lists</h2>
<ul>
<li>Pack charger
<ul>
<li>Plug adapter</li>
<li><span style="color: var(--note-red)">Spare battery</span></li>
</ul>
</li>
<li>Pack <mark>sunscreen</mark></li>
</ul>
<ol>
<li>Book flights</li>
<li>Reserve hotel
<ol>
<li>Near Alfama</li>
<li>Breakfast included</li>
</ol>
</li>
</ol>
<ul>
<li><input type="checkbox" disabled checked> Passport renewed</li>
<li><input type="checkbox" disabled> Travel insurance</li>
</ul>
<h2>Table</h2>
<table>
<thead>
<tr>
<th style="text-align: left">Item</th>
<th style="text-align: right">Cost (EUR)</th>
<th style="text-align: center">Paid</th>
</tr>
</thead>
<tbody>
<tr>
<td style="text-align: left">Flights</td>
<td style="text-align: right">240</td>
<td style="text-align: center"><span style="color: var(--note-green)">yes</span></td>
</tr>
<tr>
<td style="text-align: left">Hotel</td>
<td style="text-align: right">510</td>
<td style="text-align: center"><mark>no</mark></td>
</tr>
</tbody>
</table>
<h2>Code</h2>
<pre><code class="language-python">total = sum([240, 510])
print(f&quot;Total: {total} EUR&quot;)
</code></pre>
<h2>Photos</h2>
<p><img src="Lisbon%20trip.assets/tram.jpg" alt="Tram 28 at dusk" style="width: 70%"></p>
<p><img src="Lisbon%20trip.assets/tiles.jpg" alt="Tiles in Alfama"></p>
`;

test("9 examples/lisbon-trip.md is the section 9 example, exactly", () => {
  assert.equal(readFileSync(exampleUrl, "utf8"), specExample());
});

test("9 complete example: the rendered fragment", () => {
  assert.equal(renderNote(specExample(), { fileName: "Lisbon trip.md" }).html, EXPECTED);
});

test("9 complete example: the front matter", () => {
  assert.deepEqual(renderNote(specExample()).meta, {
    title: "Lisbon trip",
    tags: ["travel", "portugal"],
    created: "2026-11-10",
    updated: "2026-11-10",
    font: "Source Serif 4",
    size: "17px",
    theme: "paper",
  });
});

test("9 complete example: examples/lisbon-trip.html is the current output of the CLI with --page", () => {
  const page = main([new URL(exampleUrl).pathname, "--page"]);
  assert.equal(readFileSync(pageUrl, "utf8"), page);
  assert.match(page, /<link rel="stylesheet" href="\.\.\/theme\/paper\.css">/);
  assert.match(page, /<article class="note" style="font-family: 'Source Serif 4'; font-size: 17px">/);
  // The photos do not exist next to the example, so the page shows placeholders (SPEC 6).
  assert.match(page, /<span class="note-image-placeholder" data-src="Lisbon trip.assets\/tram.jpg">Tram 28 at dusk<\/span>/);
});
