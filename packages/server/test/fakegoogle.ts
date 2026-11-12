// A fake Google Fonts server on localhost for the tests (SPEC2 6): the public font list
// (`/metadata/fonts`, in the format of fonts.google.com, with its `)]}'` first line), the CSS
// endpoint and the font files. Tests never contact Google.

import http from "node:http";
import type { AddressInfo } from "node:net";
import { slugOf } from "../src/fonts.ts";

export const WOFF2 = (tag: string) => Buffer.concat([Buffer.from("wOF2"), Buffer.from(tag.padEnd(60, "."))]);

export interface Fake {
  base: string;
  requests: { url: string; ua: string }[];
  close(): Promise<void>;
  mode: {
    redirect?: boolean;
    huge?: boolean;
    slow?: boolean;
    notWoff?: boolean;
    /** The font list answers 500. */
    listDown?: boolean;
    /** The font list has an unexpected shape. */
    listChanged?: boolean;
    /** The font list is larger than 5 MB (but below 10 MB). */
    listLarge?: boolean;
    /** The CSS names font files on this other address (not one of Google's). */
    foreign?: string;
  };
}

const f = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, { thickness: null, slant: null, width: null, lineHeight: 1.2 }]));

/** Entries in the format of fonts.google.com/metadata/fonts (`familyMetadataList`). */
export const CATALOGUE = {
  familyMetadataList: [
    { family: "Caveat", displayName: null, category: "Handwriting", subsets: ["menu", "cyrillic", "latin", "latin-ext"], fonts: f(["400", "700"]), axes: [], popularity: 50 },
    { family: "IBM Plex Serif", category: "Serif", subsets: ["menu", "latin", "latin-ext", "cyrillic"], fonts: f(["300", "400", "400i", "700", "700i"]), axes: [], popularity: 120 },
    {
      family: "Inter",
      category: "Sans Serif",
      subsets: ["menu", "latin", "latin-ext", "greek"],
      fonts: f(["100", "400", "400i", "700", "700i", "900"]),
      axes: [
        { tag: "opsz", min: 14, max: 32, defaultValue: 14 },
        { tag: "wght", min: 100, max: 900, defaultValue: 400 },
      ],
      popularity: 2,
    },
    { family: "Only Ext", category: "Display", subsets: ["menu", "latin-ext"], fonts: f(["300"]), axes: [], popularity: 700 },
    { family: "Noto Sans JP", category: "Sans Serif", subsets: ["menu", "japanese"], fonts: f(["400"]), axes: [], popularity: 10 },
    { family: "Weird/Name", category: "Display", subsets: ["latin"], fonts: f(["400"]), axes: [], popularity: 30 },
    { family: "No Fonts", category: "Display", subsets: ["latin"], popularity: 31 },
  ],
};

export function css(family: string, base: string): string {
  const slug = slugOf(family);
  return [
    `/* cyrillic */\n@font-face {\n  font-family: '${family}';\n  font-style: normal;\n  font-weight: 400;\n  font-display: swap;\n  src: url(${base}/s/${slug}/cyr.woff2) format('woff2');\n  unicode-range: U+0400-045F;\n}`,
    `/* latin-ext */\n@font-face {\n  font-family: '${family}';\n  font-style: normal;\n  font-weight: 400;\n  font-display: swap;\n  src: url(${base}/s/${slug}/ext.woff2) format('woff2');\n  unicode-range: U+0100-02BA;\n}`,
    `/* latin */\n@font-face {\n  font-family: '${family}';\n  font-style: normal;\n  font-weight: 400;\n  font-display: swap;\n  src: url(${base}/s/${slug}/lat.woff2) format('woff2');\n  unicode-range: U+0000-00FF;\n  evil: url(javascript:alert(1));\n}`,
    `/* latin */\n@font-face {\n  font-family: '${family}';\n  font-style: normal;\n  font-weight: 700;\n  src: url(${base}/s/${slug}/lat.woff2) format('woff2');\n  unicode-range: U+0000-00FF;\n}`,
  ].join("\n");
}

export async function fakeGoogle(opts: { extra?: number } = {}): Promise<Fake> {
  const catalogue = {
    familyMetadataList: [
      ...CATALOGUE.familyMetadataList,
      ...Array.from({ length: opts.extra ?? 0 }, (_, i) => ({
        family: `Test Family ${String(i).padStart(3, "0")}`,
        category: "Serif",
        subsets: ["menu", "latin"],
        fonts: f(["400"]),
        axes: [],
        popularity: 1000 + i,
      })),
    ],
  };
  const fake: Fake = { base: "", requests: [], mode: {}, close: async () => {} };
  const server = http.createServer((req, res) => {
    fake.requests.push({ url: req.url ?? "", ua: req.headers["user-agent"] ?? "" });
    const u = new URL(req.url ?? "/", "http://x");
    if (fake.mode.redirect) {
      res.writeHead(302, { location: "http://127.0.0.1:1/evil" });
      return res.end();
    }
    if (u.pathname === "/metadata/fonts") {
      if (fake.mode.listDown) {
        res.writeHead(500);
        return res.end();
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      if (fake.mode.listChanged) return res.end(`)]}'\n${JSON.stringify({ families: catalogue.familyMetadataList })}`);
      if (fake.mode.listLarge) {
        const big = { ...catalogue, padding: "x".repeat(7 * 1024 * 1024) };
        return res.end(`)]}'\n${JSON.stringify(big)}`);
      }
      return res.end(`)]}'\n${JSON.stringify(catalogue)}`);
    }
    if (u.pathname === "/css2") {
      const fam = (u.searchParams.get("family") ?? "").split(":")[0];
      res.writeHead(200, { "content-type": "text/css" });
      if (u.searchParams.get("text")) return res.end(`@font-face {\n  font-family: '${fam}';\n  src: url(${fake.base}/l/preview-${slugOf(fam)}.woff2) format('woff2');\n}`);
      return res.end(css(fam, fake.mode.foreign ?? fake.base));
    }
    if (u.pathname.startsWith("/s/") || u.pathname.startsWith("/l/")) {
      if (fake.mode.slow) return; // never answers
      res.writeHead(200, { "content-type": "font/woff2" });
      if (fake.mode.huge) {
        // 6 MB, without a length header.
        const chunk = Buffer.alloc(1024 * 1024, 1);
        for (let i = 0; i < 6; i++) res.write(chunk);
        return res.end();
      }
      return res.end(fake.mode.notWoff ? Buffer.from("<svg/>") : WOFF2(u.pathname));
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  fake.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake.close = () => new Promise((r) => server.close(() => r()));
  return fake;
}

