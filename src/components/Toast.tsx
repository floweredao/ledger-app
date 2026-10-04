import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export type ToastOptions = {
  readonly message: string;
  readonly action?: { readonly label: string; readonly onAction: () => void };
  readonly durationMs?: number;
};

type ToastItem = ToastOptions & { readonly id: number };

const MAX_VISIBLE = 3;
const DEFAULT_MS = 4000;
const ACTION_MS = 6000;

let items: readonly ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

/** Imperative toast (AM-7). Undo toasts stay 6 s and pause while hovered or focused. Returns its id. */
export function toast(options: ToastOptions): number {
  const id = nextId++;
  items = [...items, { ...options, id }].slice(-MAX_VISIBLE);
  emit();
  return id;
}

export function dismissToast(id: number): void {
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) return;
  items = next;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function ToastRegion() {
  const list = useSyncExternalStore(
    subscribe,
    () => items,
    () => items,
  );
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {list.map((item) => (
        <Toast key={item.id} item={item} />
      ))}
    </div>
  );
}

function Toast({ item }: { readonly item: ToastItem }) {
  const [paused, setPaused] = useState(false);
  const duration = item.durationMs ?? (item.action ? ACTION_MS : DEFAULT_MS);
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => dismissToast(item.id), duration);
    return () => clearTimeout(timer);
  }, [paused, duration, item.id]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pause = () => setPaused(true);
    const resume = () => setPaused(false);
    const events = [
      ["pointerenter", pause],
      ["pointerleave", resume],
      ["focusin", pause],
      ["focusout", resume],
    ] as const;
    for (const [name, handler] of events) el.addEventListener(name, handler);
    return () => {
      for (const [name, handler] of events) el.removeEventListener(name, handler);
    };
  }, []);
  return (
    <div ref={ref} className="toast">
      <span className="toast-message">{item.message}</span>
      {item.action ? (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            item.action?.onAction();
            dismissToast(item.id);
          }}
        >
          {item.action.label}
        </button>
      ) : null}
    </div>
  );
}
