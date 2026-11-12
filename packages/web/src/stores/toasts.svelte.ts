// SPEC2 9.2: messages.

export type ToastKind = "info" | "warn" | "error";
export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

let list = $state<Toast[]>([]);

/** A question that needs an answer (a confirmation): one at a time. */
export interface Ask {
  message: string;
  ok: string;
  cancel: string;
  danger: boolean;
  resolve: (v: boolean) => void;
}
let asking = $state<Ask | null>(null);
let next = 1;

export const toasts = {
  get list(): readonly Toast[] {
    return list;
  },
  push(message: string, kind: ToastKind = "info", ms = kind === "info" ? 3500 : 6000): number {
    const id = next++;
    list = [...list, { id, message, kind }];
    if (ms > 0) setTimeout(() => toasts.dismiss(id), ms);
    return id;
  },
  dismiss(id: number): void {
    list = list.filter((t) => t.id !== id);
  },
  clear(): void {
    list = [];
  },
  get asking(): Ask | null {
    return asking;
  },
  /** Asks the person to confirm; resolves true for OK. */
  confirm(message: string, o: { ok?: string; cancel?: string; danger?: boolean } = {}): Promise<boolean> {
    asking?.resolve(false);
    return new Promise((resolve) => {
      asking = { message, ok: o.ok ?? "OK", cancel: o.cancel ?? "Cancel", danger: o.danger ?? false, resolve };
    });
  },
  answer(v: boolean): void {
    const a = asking;
    asking = null;
    a?.resolve(v);
  },
};
