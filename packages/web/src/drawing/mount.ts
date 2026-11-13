// SPEC-DRAWINGS 3: Excalidraw, mounted as its React component with `createRoot` and
// `createElement` (no JSX, so no React plugin). This module, and with it React, Excalidraw and
// Excalidraw's CSS, is loaded only when a drawing is first opened: the drawing screen imports it
// with `import()`, after setting `window.EXCALIDRAW_ASSET_PATH` (which must be set before these
// imports run).

import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { CaptureUpdateAction, convertToExcalidrawElements, Excalidraw, MainMenu, useHandleLibrary } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import "./excalidraw-overrides.css";
import type { DrawingScene } from "../../../core/src/index.ts";

export interface MountOptions {
  scene: DrawingScene;
  /** The history screen shows a version in view mode. */
  viewMode?: boolean;
  theme: "light" | "dark";
  /** Where the shape library is kept in local storage (by user id); null: not kept. */
  libraryKey: string | null;
  /** The address libraries.excalidraw.com sends a library back to. */
  libraryReturnUrl: string;
  /** Every change Excalidraw reports (each pointer move too). */
  onChange?: () => void;
  /** The browser refused to keep the library. */
  onLibraryNotKept?: () => void;
}

/** What the screen holds of the mounted component. */
export interface DrawingHandle {
  /** Resolves once the drawing is ready (SPEC-DRAWINGS 4.3): Excalidraw has the scene and its
   *  images, `document.fonts.ready` has resolved, and one animation frame has passed. */
  ready: Promise<void>;
  /** The scene as Excalidraw has it: every element (deleted ones too), the app state, images. */
  scene(): DrawingScene;
  /** Replaces the scene (Take theirs, a draft, another version): Excalidraw is mounted again
   *  with it, as on opening. Resolves when the drawing is ready again. */
  load(scene: DrawingScene): Promise<void>;
  /** The test hook (SPEC-DRAWINGS 7): what the person's own action would do. */
  addText(text: string, x: number, y: number): void;
  setBackground(colour: string): void;
  addImage(file: File): Promise<void>;
  unmount(): void;
}

// Excalidraw's types reach React's, which are not installed (no other dependency may be added),
// so its API is used untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Api = any;

/** The library kept in local storage under the user's id (SPEC-DRAWINGS 3.3). */
export const libraryStorageKey = (userId: string) => `nook:library:${userId}`;

function readLibrary(key: string | null): unknown[] {
  if (!key) return [];
  try {
    const raw = globalThis.localStorage?.getItem(key);
    const items = raw ? JSON.parse(raw) : [];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Waits until Excalidraw has taken in its initial scene (`isLoading` ends with it). */
async function sceneTaken(api: Api): Promise<void> {
  for (let i = 0; i < 600 && api.getAppState().isLoading; i++) await frame();
}

/** Every image of the scene decoded (Excalidraw draws them from the same data URLs). */
async function imagesDecoded(files: Record<string, unknown>): Promise<void> {
  await Promise.all(
    Object.values(files).map(async (f) => {
      const url = (f as { dataURL?: unknown }).dataURL;
      if (typeof url !== "string") return;
      const img = new Image();
      img.src = url;
      await img.decode().catch(() => {});
    }),
  );
}

export function mountDrawing(el: HTMLElement, o: MountOptions): DrawingHandle {
  let api: Api = null;
  let generation = 0;
  /** The scene last given, which `scene()` answers with until Excalidraw has it. */
  let current: DrawingScene = o.scene;
  let resolveReady: () => void = () => {};

  async function becameReady(a: Api, scene: DrawingScene, g: number): Promise<void> {
    await sceneTaken(a);
    await imagesDecoded(scene.files);
    await frame();
    await document.fonts.ready;
    await frame();
    if (g !== generation) return;
    api = a;
    resolveReady();
  }

  function Host(props: { scene: DrawingScene; g: number }) {
    const [a, setA] = useState(null as Api);
    // Takes in a library sent back in the address (`#addLibrary=…`).
    useHandleLibrary({ excalidrawAPI: a });
    const { appState } = props.scene;
    return createElement(
      Excalidraw,
      {
        excalidrawAPI: (x: Api) => {
          setA(x);
          void becameReady(x, props.scene, props.g);
        },
        initialData: {
          elements: props.scene.elements,
          appState: { ...appState, viewModeEnabled: !!o.viewMode },
          files: props.scene.files,
          libraryItems: readLibrary(o.libraryKey),
          scrollToContent: true,
        },
        viewModeEnabled: !!o.viewMode,
        theme: o.theme,
        libraryReturnUrl: o.libraryReturnUrl,
        // Hidden (3.3): the AI features; collaboration has no button without renderTopRightUI.
        aiEnabled: false,
        isCollaborating: false,
        autoFocus: !o.viewMode,
        handleKeyboardGlobally: false,
        UIOptions: { canvasActions: { toggleTheme: null, saveToActiveFile: false } },
        onChange: () => o.onChange?.(),
        onLibraryChange: (items: unknown[]) => {
          if (!o.libraryKey) return;
          try {
            globalThis.localStorage.setItem(o.libraryKey, JSON.stringify(items));
          } catch {
            o.onLibraryNotKept?.();
          }
        },
      },
      // Nook's own menu: Excalidraw's, without collaboration, the theme and the social links.
      createElement(
        MainMenu,
        null,
        createElement(MainMenu.DefaultItems.LoadScene),
        createElement(MainMenu.DefaultItems.Export),
        createElement(MainMenu.DefaultItems.SaveAsImage),
        createElement(MainMenu.DefaultItems.SearchMenu),
        createElement(MainMenu.DefaultItems.Help),
        createElement(MainMenu.DefaultItems.ClearCanvas),
        createElement(MainMenu.Separator),
        createElement(MainMenu.DefaultItems.ChangeCanvasBackground),
      ),
    );
  }

  const root = createRoot(el);
  function render(scene: DrawingScene): Promise<void> {
    const g = ++generation;
    api = null;
    current = scene;
    const ready = new Promise<void>((r) => (resolveReady = r));
    root.render(createElement(Host, { key: `scene-${g}`, scene, g }));
    return ready;
  }
  const ready = render(o.scene);

  const canvas = () => el.querySelector("canvas.excalidraw__canvas.interactive") as HTMLCanvasElement | null;

  return {
    ready,
    scene: () => (api ? { elements: [...api.getSceneElementsIncludingDeleted()], appState: api.getAppState(), files: { ...api.getFiles() } } : current),
    load: (scene) => render(scene),
    addText(text, x, y) {
      if (!api) return;
      const made = convertToExcalidrawElements([{ type: "text", x, y, text }]);
      api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...made], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    },
    setBackground(colour) {
      api?.updateScene({ appState: { viewBackgroundColor: colour }, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    },
    async addImage(file) {
      // As a person's drop of the file on the canvas.
      const target = canvas();
      if (!api || !target) return;
      const before = Object.keys(api.getFiles()).length;
      const dt = new DataTransfer();
      dt.items.add(file);
      const r = target.getBoundingClientRect();
      for (const type of ["dragover", "drop"]) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + r.width / 3, clientY: r.top + r.height / 3 }));
      for (let i = 0; i < 300 && Object.keys(api.getFiles()).length === before; i++) await frame();
    },
    unmount() {
      generation++;
      root.unmount();
    },
  };
}
