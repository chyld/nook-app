// SPEC2 9.2: the person's saved styles, as the server holds them.

import type { Style } from "../../../contract/src/index.ts";
import { api } from "../lib/api.ts";

const s = $state({ list: [] as Style[], loaded: false });

export const styles = {
  get list(): readonly Style[] {
    return s.list;
  },
  get loaded(): boolean {
    return s.loaded;
  },
  async load(): Promise<void> {
    s.list = (await api().styles()).styles;
    s.loaded = true;
  },
  /** Saves under a name (replacing one of that name), or renames `renameFrom` in one step. */
  async save(style: Style, renameFrom?: string): Promise<void> {
    s.list = (await api().styleSave(style.name, style, renameFrom)).styles;
  },
  async remove(name: string): Promise<void> {
    s.list = (await api().styleDelete(name)).styles;
  },
};
