type Listener = (prefix: string) => void;
const listeners = new Set<Listener>();

/** Refetches every mounted `useApi` whose key starts with `prefix` (e.g. `transactions`, `stats`). */
export function invalidate(prefix: string): void {
  for (const listener of listeners) listener(prefix);
}

export function subscribeInvalidate(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
