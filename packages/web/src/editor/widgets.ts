// SPEC2 8: the photo and checkbox widgets. A task's box sends `toggleTask`; dragging a photo's
// handle previews the width and, on release, sends `setImageWidth` with any whole percentage.

import type { EditorView } from "@codemirror/view";
import type { Model } from "../../../core/src/index.ts";
import { editorField } from "./field.ts";
import { dispatchIntent } from "./dispatch.ts";

/** A click on a task's box: `at` is a position on the task's line (SPEC-NOTES). */
export function clickTask(view: EditorView, el: HTMLElement): void {
  dispatchIntent(view, { type: "toggleTask", at: view.posAtDOM(el) }, { still: true });
}

/** The index of the photo whose widget starts at `pos` (a widget replaces [start, end), so
 *  `posAtDOM` of its box is its start; the photo before it ends there when two touch). */
export function photoAt(m: Model, pos: number): number {
  return m.chars.findIndex((c) => c.kind === "image" && c.start === pos);
}

/** The index of the visible character that is the photo drawn by `box`. */
function photoIndex(view: EditorView, box: HTMLElement): number {
  return photoAt(view.state.field(editorField).model, view.posAtDOM(box));
}

/** The handles of a photo: where each sits, and how the pointer's movement becomes width.
 *  `x` and `y` say how much one pixel right or down adds to the width (y by the photo's shape). */
const HANDLES: { at: string; x: number; y: number; testid: string }[] = [
  { at: "se", x: 1, y: 0, testid: "photo-handle" },
  { at: "e", x: 1, y: 0, testid: "photo-handle-e" },
  { at: "w", x: -1, y: 0, testid: "photo-handle-w" },
  { at: "s", x: 0, y: 1, testid: "photo-handle-s" },
  { at: "sw", x: -1, y: 0, testid: "photo-handle-sw" },
];

/** A photo gets handles on its sides and lower corners; dragging one previews the width,
 *  letting go writes it. */
export function photoResize(view: EditorView, box: HTMLElement): void {
  const label = document.createElement("span");
  label.className = "rich-photo-size";
  label.setAttribute("aria-hidden", "true");
  const start = (handle: HTMLElement, dir: { x: number; y: number }) => (down: PointerEvent) => {
    if (down.button !== 0) return;
    down.preventDefault();
    down.stopPropagation();
    const line = (box.closest(".cm-line") as HTMLElement | null) ?? view.contentDOM;
    const cs = getComputedStyle(line);
    const room = Math.max(60, line.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    const rect = box.getBoundingClientRect();
    const from = rect.width;
    const shape = rect.height > 0 ? rect.width / rect.height : 1;
    let width = from;
    const percent = () => Math.max(5, Math.min(100, Math.round((width / room) * 100)));
    try {
      handle.setPointerCapture(down.pointerId);
    } catch {
      /* a synthetic event has no pointer to capture */
    }
    box.classList.add("is-resizing");
    const move = (e: PointerEvent) => {
      const by = dir.x * (e.clientX - down.clientX) + dir.y * shape * (e.clientY - down.clientY);
      width = Math.max(room * 0.05, Math.min(room, from + by));
      box.style.width = `${width}px`;
      box.classList.add("has-width");
      label.textContent = `${percent()}%`;
    };
    /** The photo as the note has it: its width and sizing class (review of alpha's changes, 6). */
    const reset = () => {
      box.style.width = box.dataset.width ?? "";
      box.classList.toggle("has-width", !!box.dataset.width);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      box.classList.remove("is-resizing");
      label.textContent = "";
    };
    const up = () => {
      end();
      if (Math.abs(width - from) < 2) return reset();
      const i = photoIndex(view, box);
      // The view does not scroll.
      const ok = i >= 0 && dispatchIntent(view, { type: "setImageWidth", at: i, value: percent() }, { still: true });
      if (!ok) reset();
    };
    // A drag the browser takes back (a touch that becomes a scroll, a call) writes nothing.
    const cancel = () => {
      end();
      reset();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", cancel);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };
  const handles = HANDLES.map((h) => {
    const handle = document.createElement("span");
    handle.className = `rich-photo-handle rich-photo-handle-${h.at}`;
    handle.dataset.testid = h.testid;
    handle.title = "Drag to resize";
    handle.addEventListener("pointerdown", start(handle, h));
    // The corner handle is the photo's one width slider, for the keyboard and screen readers;
    // the other four are for the pointer and touch only (review of alpha's changes, 19).
    if (h.at === "se") keyboardSlider(view, box, handle);
    else handle.setAttribute("aria-hidden", "true");
    return handle;
  });
  box.append(...handles, label);
}

/** The width of a photo as a percentage of the line, as the slider shows it. */
function widthNow(box: HTMLElement): number {
  const set = /^(\d+)%$/.exec(box.dataset.width ?? "");
  if (set) return Number(set[1]);
  const line = (box.closest(".cm-line") as HTMLElement | null) ?? box.parentElement;
  if (!line) return 100;
  const cs = getComputedStyle(line);
  const room = Math.max(60, line.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  return Math.max(5, Math.min(100, Math.round((box.getBoundingClientRect().width / room) * 100)));
}

/** Arrow keys change the width by 5 (Home: 5%, End: 100%); each change is one `setImageWidth`. */
function keyboardSlider(view: EditorView, box: HTMLElement, handle: HTMLElement): void {
  handle.tabIndex = 0;
  handle.setAttribute("role", "slider");
  handle.setAttribute("aria-label", "Photo width");
  handle.setAttribute("aria-valuemin", "5");
  handle.setAttribute("aria-valuemax", "100");
  const show = () => {
    const w = widthNow(box);
    handle.setAttribute("aria-valuenow", String(w));
    handle.setAttribute("aria-valuetext", `${w}%`);
  };
  handle.addEventListener("focus", show);
  box.querySelector("img")?.addEventListener("load", show);
  show();
  handle.addEventListener("keydown", (e) => {
    const now = widthNow(box);
    const step: Record<string, number> = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -20, PageUp: 20 };
    const to = e.key === "Home" ? 5 : e.key === "End" ? 100 : e.key in step ? now + step[e.key] : null;
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation();
    const value = Math.max(5, Math.min(100, to));
    if (value === now) return;
    const pos = view.posAtDOM(box);
    const i = photoIndex(view, box);
    if (i < 0 || !dispatchIntent(view, { type: "setImageWidth", at: i, value }, { still: true })) return;
    // The photo is drawn again at its new width: the focus goes to its new slider.
    const again = [...view.contentDOM.querySelectorAll<HTMLElement>('[data-testid="photo"]')].find((b) => {
      try {
        return view.posAtDOM(b) === pos;
      } catch {
        return false;
      }
    });
    again?.querySelector<HTMLElement>('[data-testid="photo-handle"]')?.focus();
  });
}
