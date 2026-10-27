import { CircleAlert } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useMessages } from "../i18n";
import { common } from "../i18n/common";
import { componentMessages } from "./messages";

export type ToastOptions = {
  readonly message: string;
  readonly action?: { readonly label: string; readonly accessibleName?: string; readonly onAction: () => void };
  readonly durationMs?: number;
  /** Failures carry a symbol as well as text, so the outcome does not rest on reading the words alone. */
  readonly tone?: "error";
};

type ToastItem = ToastOptions & { readonly id: number };

const MAX_VISIBLE = 3;
const DEFAULT_MS = 4000;
const MAX_MS = 10000;
/** Longer messages stay longer, so a timed notice still leaves time to read it (Apple HIG Accessibility). */
const readingTime = (message: string) => Math.min(MAX_MS, Math.max(DEFAULT_MS, 1000 + message.length * 80));

let items: readonly ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

/** Action toasts stay until acted on or dismissed; ordinary notices expire. Returns its id. */
export function toast(options: ToastOptions): number {
  const id = nextId++;
  const next = [...items, { ...options, id }];
  const ordinary = next.filter((item) => !item.action).slice(-MAX_VISIBLE);
  items = next.filter((item) => item.action || ordinary.includes(item));
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
  const ref = useRef<HTMLDivElement>(null);
  // Toasts float over the content, so the page reserves their height below its end: the last row can
  // always scroll clear of them. A reader already at the end stays there instead of losing the last row.
  useEffect(() => {
    const region = ref.current;
    if (!region) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => {
      const atEnd = window.scrollY + window.innerHeight >= root.scrollHeight - 2;
      root.style.setProperty("--toast-clearance", `${region.offsetHeight}px`);
      if (atEnd) window.scrollTo(window.scrollX, root.scrollHeight);
    });
    observer.observe(region);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--toast-clearance");
    };
  }, []);
  return (
    <div ref={ref} className="toast-region" role="status" aria-live="polite">
      {list.map((item) => (
        <Toast key={item.id} item={item} />
      ))}
    </div>
  );
}

function Toast({ item }: { readonly item: ToastItem }) {
  const t = useMessages(componentMessages);
  const c = useMessages(common);

  const [paused, setPaused] = useState(false);
  const duration = item.durationMs ?? readingTime(item.message);
  useEffect(() => {
    if (paused || item.action) return;
    const timer = setTimeout(() => dismissToast(item.id), duration);
    return () => clearTimeout(timer);
  }, [paused, duration, item.id, item.action]);
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
    <div ref={ref} className={item.action ? "toast toast-has-action" : "toast"} data-tone={item.tone}>
      {item.tone === "error" ? <CircleAlert className="toast-icon" aria-hidden="true" /> : null}
      <span className="toast-message">{item.message}</span>
      {item.action ? (
        <div className="toast-actions">
          <button
            type="button"
            className="toast-action"
            aria-label={item.action.accessibleName}
            onClick={() => {
              item.action?.onAction();
              dismissToast(item.id);
            }}
          >
            {item.action.label}
          </button>
          <button
            type="button"
            className="toast-action"
            aria-label={t.dismissNotification(item.message)}
            onClick={() => dismissToast(item.id)}
          >
            {c.close}
          </button>
        </div>
      ) : null}
    </div>
  );
}
