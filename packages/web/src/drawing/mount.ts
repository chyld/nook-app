// SPEC-DRAWINGS 3: Excalidraw, mounted as its React component with `createRoot` and
// `createElement` (no JSX, so no React plugin). This module, and with it React, Excalidraw and
// Excalidraw's CSS, is loaded only when a drawing is first opened: the drawing screen imports it
// with `import()`, after setting `window.EXCALIDRAW_ASSET_PATH` (which must be set before these
// imports run).

import { createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CaptureUpdateAction, Excalidraw, MainMenu, useHandleLibrary } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import "./excalidraw-overrides.css";

// Excalidraw's types reach React's, which are not installed (SPEC-DRAWINGS 1.1: no other
// dependency); the few shapes used here are written out.
export interface SceneElement {
  id: string;
  type: string;
  version: number;
  isDeleted?: boolean;
  fileId?: string | null;
  [k: string]: unknown;
}
export interface SceneFile {
  id: string;
  mimeType: string;
  dataURL: string;
  created?: number;
  [k: string]: unknown;
}
export interface Scene {
  elements: SceneElement[];
  appState: Record<string, unknown>;
  files: Record<string, SceneFile>;
}

export interface MountOptions {
  scene: Scene;
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
  /** A scene file was loaded by the menu or by a drop. */
  onSceneLoaded?: () => void;
}

/** What the screen holds of the mounted component. */
export interface DrawingHandle {
  /** Resolves once Excalidraw has the scene and its images (SPEC-DRAWINGS 4.3, without the
   *  fonts and the frame, which the screen waits for). */
  ready: Promise<void>;
  elements(): SceneElement[];
  appState(): Record<string, unknown>;
  files(): Record<string, SceneFile>;
  /** Replaces the scene (Take theirs, a draft), without an undo step. */
  setScene(scene: Scene): void;
  /** Adds images to the scene's files. */
  addFiles(files: SceneFile[]): void;
  /** Adds elements (the test hook). */
  addElements(elements: SceneElement[]): void;
  setAppState(patch: Record<string, unknown>): void;
  /** Excalidraw's own API, for the test hook. */
  api: unknown;
  unmount(): void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Api = any;

/** Library items kept in local storage under the user's id (SPEC-DRAWINGS 3.3). */
export const libraryStorageKey = (userId: string) => `nook:library:${userId}`;

function libraryAdapter(key: string | null, refused: () => void) {
  return {
    load() {
      if (!key) return { libraryItems: [] };
      try {
        const raw = globalThis.localStorage?.getItem(key);
        const items = raw ? JSON.parse(raw) : [];
        return { libraryItems: Array.isArray(items) ? items : [] };
      } catch {
        return { libraryItems: [] };
      }
    },
    save(data: { libraryItems: unknown[] }) {
      if (!key) return;
      try {
        globalThis.localStorage.setItem(key, JSON.stringify(data.libraryItems));
      } catch {
        refused();
      }
    },
  };
}

export function mountDrawing(el: HTMLElement, o: MountOptions): DrawingHandle {
  let api: Api = null;
  let readyResolve: () => void = () => {};
  const ready = new Promise<void>((r) => (readyResolve = r));
  const adapter = libraryAdapter(o.libraryKey, () => o.onLibraryNotKept?.());

  function Host() {
    const [a, setA] = useState(null as Api);
    // Takes in a library sent back in the address (`#addLibrary=…`), and keeps the library by
    // the adapter (load at start, save on every change).
    useHandleLibrary({ excalidrawAPI: a, adapter });
    useEffect(() => {
      if (!a) return;
      api = a;
      // The scene and its images are given in initialData; images load as Excalidraw draws them.
      readyResolve();
    }, [a]);
    return createElement(
      Excalidraw,
      {
        excalidrawAPI: (x: Api) => setA(x),
        initialData: {
          elements: o.scene.elements,
          appState: { ...o.scene.appState, viewModeEnabled: !!o.viewMode },
          files: o.scene.files,
          scrollToContent: true,
        },
        viewModeEnabled: !!o.viewMode,
        theme: o.theme,
        libraryReturnUrl: o.libraryReturnUrl,
        aiEnabled: false,
        isCollaborating: false,
        autoFocus: !o.viewMode,
        handleKeyboardGlobally: false,
        UIOptions: { canvasActions: { toggleTheme: null, saveToActiveFile: false } },
        onChange: () => o.onChange?.(),
      },
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
  root.render(createElement(Host));

  return {
    ready,
    get api() {
      return api;
    },
    elements: () => (api ? [...api.getSceneElementsIncludingDeleted()] : []),
    appState: () => (api ? api.getAppState() : {}),
    files: () => (api ? { ...api.getFiles() } : {}),
    setScene(scene) {
      if (!api) return;
      api.addFiles(Object.values(scene.files));
      api.updateScene({ elements: scene.elements, appState: scene.appState, captureUpdate: CaptureUpdateAction.NEVER });
      api.history.clear();
    },
    addFiles(files) {
      api?.addFiles(files);
    },
    addElements(elements) {
      if (!api) return;
      api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...elements], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    },
    setAppState(patch) {
      api?.updateScene({ appState: patch, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    },
    unmount() {
      root.unmount();
    },
  };
}
