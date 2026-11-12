// Pass 3 of SPEC 5 step 4: the bare URL pass. GFM extended autolinks (GFM 0.29 section 6.9),
// found in each run of literal text the first two passes left, in every inline scope except
// link text. SPEC 5: only `http://`, `https://`, `www.` and email addresses start a bare URL.
// The URL text is used as written: entity references in it are not decoded.

import { charBefore, isAsciiPunct, isWhitespace } from "../chars.ts";
import { scopeOf, type Item, type Scope } from "./items.ts";

export function bareUrlPass(scope: Scope, t: string, inLink = false): void {
  for (const it of scope.items) {
    const inner = scopeOf(it);
    if (inner) bareUrlPass(inner, t, inLink || it.k === "link");
  }
  // Link text is excluded, and so is every scope inside link text, so that no link is created
  // inside a link (see SPEC-ISSUES.md).
  if (inLink) return;
  const items: Item[] = [];
  for (const it of scope.items) {
    if (it.k !== "text") {
      items.push(it);
      continue;
    }
    const run = new Run(t, it.s, it.e);
    let cursor = it.s;
    let j = it.s;
    while (j < it.e) {
      if (t[j] === "\\" && j + 1 < it.e && isAsciiPunct(t[j + 1])) {
        j += 2;
        continue;
      }
      const m = canStart(t, j, scope) ? run.match(j) : null;
      if (m) {
        if (j > cursor) items.push({ k: "text", s: cursor, e: j });
        items.push({ k: "bare", s: j, e: m.end, href: m.href, text: m.text });
        cursor = j = m.end;
        continue;
      }
      j++;
    }
    if (cursor < it.e) items.push({ k: "text", s: cursor, e: it.e });
  }
  scope.items = items;
}

/**
 * GFM: an extended autolink can only come at the beginning of a line, after whitespace, or
 * after `*`, `_`, `~` or `(`. SPEC 5: the start of an inline scope counts as the start of a line.
 * Otherwise the character before is read from the source text.
 */
function canStart(t: string, j: number, scope: Scope): boolean {
  if (j === scope.start) return true;
  const before = charBefore(t, j);
  return isWhitespace(before) || "*_~(".includes(before);
}

const DOMAIN_CHAR = /[\p{L}\p{N}_-]/u;
const EMAIL_LOCAL = /[a-zA-Z0-9.\-_+]/;
const EMAIL_DOMAIN = /[a-zA-Z0-9\-_.]/;

/**
 * GFM valid domain: segments of letters, digits, `_` and `-` separated by periods, with at
 * least one period, and no underscore in the last two segments. A final period is not part of
 * the domain (it is trailing punctuation).
 */
function isValidDomain(domain: string): boolean {
  const segments = domain.split(".");
  while (segments.length > 0 && segments[segments.length - 1] === "") segments.pop();
  if (segments.length < 2 || segments.some((s) => s === "")) return false;
  return !segments.slice(-2).some((s) => s.includes("_"));
}

interface BareMatch {
  end: number;
  href: string;
  text: string;
}

/**
 * One run of literal text [s, e), searched for bare URLs. Candidates can start at many places in
 * a run, so the scans that would repeat are shared: the end of a URL path, the parenthesis
 * counts, and a failed email local part. This keeps the pass linear in the length of the run.
 */
class Run {
  t: string;
  s: number;
  e: number;
  /** opens[i] and closes[i]: the number of `(` and `)` in t[s, s + i). */
  opens: Int32Array;
  closes: Int32Array;
  /** The last path scan: from `pathFrom`, the path ended at `pathTo`. */
  pathFrom = -1;
  pathTo = -1;
  /** An email address cannot start before this position (its local part already failed). */
  emailFailUntil = -1;

  constructor(t: string, s: number, e: number) {
    this.t = t;
    this.s = s;
    this.e = e;
    this.opens = new Int32Array(e - s + 1);
    this.closes = new Int32Array(e - s + 1);
    for (let i = s; i < e; i++) {
      this.opens[i - s + 1] = this.opens[i - s] + (t[i] === "(" ? 1 : 0);
      this.closes[i - s + 1] = this.closes[i - s] + (t[i] === ")" ? 1 : 0);
    }
  }

  match(j: number): BareMatch | null {
    const t = this.t;
    if (t.startsWith("www.", j)) return this.urlLike(j, 4, "http://");
    for (const scheme of ["http://", "https://"]) {
      if (t.startsWith(scheme, j)) return this.urlLike(j, scheme.length, "");
    }
    if (j >= this.emailFailUntil) {
      const e = this.emailEnd(j);
      if (e >= 0) {
        const text = t.slice(j, e);
        return { end: e, href: "mailto:" + text, text };
      }
    }
    return null;
  }

  /** The end of the run of domain characters (letters, digits, `_`, `-` and `.`) from `k`. */
  domainEnd(k: number): number {
    const t = this.t;
    while (k < this.e) {
      const cp = String.fromCodePoint(t.codePointAt(k)!);
      if (cp !== "." && !DOMAIN_CHAR.test(cp)) break;
      k += cp.length;
    }
    return k;
  }

  /** The end of the path after a domain: up to whitespace, `<`, or a backslash escape. */
  pathEnd(k: number): number {
    // A later scan from inside the last scanned path ends where that one ended.
    if (k >= this.pathFrom && k <= this.pathTo) return this.pathTo;
    const t = this.t;
    let p = k;
    while (p < this.e) {
      const c = t[p];
      if (c === "<" || isWhitespace(c)) break;
      if (c === "\\" && p + 1 < this.e && isAsciiPunct(t[p + 1])) break;
      p++;
    }
    this.pathFrom = k;
    this.pathTo = p;
    return p;
  }

  /** GFM extended autolink path validation: trailing punctuation, unmatched `)`, entity-like `;`. */
  trimTrailing(start: number, end: number): number {
    const t = this.t;
    const at = (i: number) => i - this.s;
    for (;;) {
      if (end <= start) return end;
      const c = t[end - 1];
      if ("?!.,:*_~".includes(c)) {
        end--;
        continue;
      }
      if (c === ")") {
        const open = this.opens[at(end)] - this.opens[at(start)];
        const close = this.closes[at(end)] - this.closes[at(start)];
        if (close > open) {
          end--;
          continue;
        }
        return end;
      }
      if (c === ";") {
        // `&` followed by one or more letters or digits, then the `;`.
        let k = end - 2;
        while (k >= start && /[A-Za-z0-9]/.test(t[k])) k--;
        if (k >= start && k < end - 2 && t[k] === "&") {
          end = k;
          continue;
        }
        return end;
      }
      return end;
    }
  }

  urlLike(j: number, prefixLen: number, hrefPrefix: string): BareMatch | null {
    const t = this.t;
    const dEnd = this.domainEnd(j + prefixLen);
    // Trimming removes at most trailing `.` and `_` from the domain, so a domain that is not
    // valid even without them can never become valid: give up before scanning the path.
    if (!isValidDomain(t.slice(j + prefixLen, dEnd).replace(/[._]+$/, ""))) return null;
    const pEnd = this.pathEnd(dEnd);
    const linkEnd = this.trimTrailing(j, pEnd);
    const domain = t.slice(j + prefixLen, Math.min(dEnd, linkEnd));
    if (!isValidDomain(domain)) return null;
    const text = t.slice(j, linkEnd);
    return { end: linkEnd, href: hrefPrefix + text, text };
  }

  /** An email address at `k`: local part, `@`, domain. Returns the end, or -1. */
  emailEnd(k: number): number {
    const t = this.t;
    let p = k;
    while (p < this.e && EMAIL_LOCAL.test(t[p])) p++;
    // Any start inside this local part reaches the same `@` and domain, so fails the same way.
    const fail = () => {
      this.emailFailUntil = p + 1;
      return -1;
    };
    if (p === k || t[p] !== "@") return fail();
    const ds = p + 1;
    let q = ds;
    while (q < this.e && EMAIL_DOMAIN.test(t[q])) q++;
    // A period at the end is not part of the address.
    while (q > ds && t[q - 1] === ".") q--;
    const domain = t.slice(ds, q);
    if (!domain.includes(".")) return fail();
    if (domain.split(".").some((s) => s === "")) return fail();
    const last = domain[domain.length - 1];
    if (last === "-" || last === "_") return fail();
    return q;
  }
}
