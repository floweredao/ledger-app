import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { readCache, writeCache } from "./cache";
import { subscribeInvalidate } from "./invalidate";
import { applyOverlay } from "./outbox";
import { apiJson, isNetworkError, isOnline, subscribeNetwork } from "./transport";

export { invalidate } from "./invalidate";

export type ApiState<T> = {
  readonly data: T | undefined;
  readonly error: unknown;
  readonly loading: boolean;
  /** True when the data came from the offline cache because the network failed. */
  readonly offline: boolean;
  readonly reload: () => void;
};

type Snapshot = {
  readonly key: string | null;
  readonly data: unknown;
  readonly error: unknown;
  readonly loading: boolean;
  readonly offline: boolean;
};

/** Last good response per key for instant re-renders (stale-while-revalidate). */
const memory = new Map<string, unknown>();
export function clearMemoryCache(): void {
  memory.clear();
}

const initial = (key: string | null): Snapshot => ({
  key,
  data: key === null ? undefined : memory.get(key),
  error: undefined,
  loading: key !== null,
  offline: false,
});

/**
 * Fetches `key` (`path?query` without `/api/v1/`) unless it is null. Success is kept in memory and written
 * with `writeCache(key)`; a network failure falls back to `readCache(key)`. Data passes through
 * `applyOverlay(key)` so queued offline mutations appear. `invalidate(prefix)` refetches matching keys.
 */
export function useApi<T>(key: string | null, fetcher?: () => Promise<T>): ApiState<T> {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const [snapshot, setSnapshot] = useState<Snapshot>(() => initial(key));
  const [version, setVersion] = useState(0);
  const request = useMemo(() => ({ key, version }), [key, version]);

  useEffect(() => {
    const { key } = request;
    if (key === null) {
      setSnapshot(initial(null));
      return;
    }
    let cancelled = false;
    setSnapshot((prev) =>
      prev.key === key ? { ...prev, loading: true, error: undefined } : { ...initial(key), loading: true },
    );
    const run = fetcherRef.current ?? (() => apiJson<T>(key));
    run().then(
      (data) => {
        memory.set(key, data);
        writeCache(key, data).catch((error: unknown) => console.warn("cache write failed", error));
        if (!cancelled) setSnapshot({ key, data, error: undefined, loading: false, offline: false });
      },
      async (error: unknown) => {
        if (!isNetworkError(error)) {
          if (!cancelled) setSnapshot((prev) => ({ ...prev, key, error, loading: false, offline: false }));
          return;
        }
        const cached = memory.has(key) ? memory.get(key) : await readCache<T>(key);
        if (cancelled) return;
        setSnapshot({
          key,
          data: cached,
          error: cached === undefined ? error : undefined,
          loading: false,
          offline: true,
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [request]);

  useEffect(() => {
    if (key === null) return;
    return subscribeInvalidate((prefix) => {
      if (key.startsWith(prefix)) setVersion((v) => v + 1);
    });
  }, [key]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const current = snapshot.key === key ? snapshot : initial(key);
  return {
    data: key === null ? undefined : applyOverlay(key, current.data as T | undefined),
    error: current.error,
    loading: current.loading,
    offline: current.offline,
    reload,
  };
}

/** Browser reachability as seen by the last request and the online/offline events. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeNetwork, isOnline, () => true);
}
