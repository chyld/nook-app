// SPEC2 9.1: a small router over the History API that maps addresses to screens. Leaving a
// screen can be held up by a guard (a note with unsaved changes asks first).

export type Route =
  | { name: "login" }
  | { name: "home" }
  | { name: "note"; id: string }
  | { name: "history"; id: string }
  | { name: "trash" }
  | { name: "fonts" }
  | { name: "styles" }
  | { name: "account" }
  | { name: "notfound" };

const NOTE_ID = /^[a-z2-7]{24}$/;

export function match(path: string): Route {
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/") return { name: "home" };
  if (p === "/login") return { name: "login" };
  if (p === "/trash") return { name: "trash" };
  if (p === "/fonts") return { name: "fonts" };
  if (p === "/styles") return { name: "styles" };
  if (p === "/account") return { name: "account" };
  const n = /^\/n\/([^/]+)(\/history)?$/.exec(p);
  if (n && NOTE_ID.test(n[1])) return n[2] ? { name: "history", id: n[1] } : { name: "note", id: n[1] };
  return { name: "notfound" };
}

/** Asks whether the current screen may be left; resolves false to stay. */
type Guard = () => Promise<boolean>;

const s = $state({ path: typeof location === "undefined" ? "/" : location.pathname });
let guard: Guard | null = null;

export const router = {
  get path(): string {
    return s.path;
  },
  get route(): Route {
    return match(s.path);
  },
  setGuard(g: Guard | null): void {
    guard = g;
  },
  async go(path: string, opts: { replace?: boolean; force?: boolean } = {}): Promise<boolean> {
    if (path === s.path) return true;
    if (!opts.force && guard && !(await guard())) return false;
    if (opts.replace) history.replaceState(null, "", path);
    else history.pushState(null, "", path);
    s.path = path;
    window.scrollTo(0, 0);
    return true;
  },
  start(): void {
    window.addEventListener("popstate", () => {
      const want = location.pathname;
      if (!guard) {
        s.path = want;
        return;
      }
      // Back or forward from a note with unsaved changes: stay until the person says so.
      const here = s.path;
      history.pushState(null, "", here);
      void guard().then((ok) => {
        if (ok) {
          history.replaceState(null, "", want);
          s.path = want;
        }
      });
    });
  },
};
