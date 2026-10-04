import { useCallback, useEffect, useState } from "react";

export type EntryRequest = {
  readonly id?: string;
  /** `YYYY-MM-DD` */
  readonly date?: string;
  readonly templateId?: string;
};

const EVENT = "ledger:open-entry";

/** Opens the entry sheet from anywhere (tab bar, calendar day, list row). EntryHost (T15) listens. */
export function openEntry(request: EntryRequest = {}): void {
  window.dispatchEvent(new CustomEvent<EntryRequest>(EVENT, { detail: request }));
}

export function useEntryRequest(): { readonly request: EntryRequest | null; readonly close: () => void } {
  const [request, setRequest] = useState<EntryRequest | null>(null);
  useEffect(() => {
    const listener = (event: Event) => setRequest((event as CustomEvent<EntryRequest>).detail ?? {});
    window.addEventListener(EVENT, listener);
    return () => window.removeEventListener(EVENT, listener);
  }, []);
  const close = useCallback(() => setRequest(null), []);
  return { request, close };
}
