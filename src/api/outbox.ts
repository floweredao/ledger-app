import { useEffect, useSyncExternalStore } from "react";
import { z } from "zod";
import { TransactionSchema } from "../../shared/schema";
import { toast } from "../components/Toast";
import { overlayTransactions } from "../features/offline/overlay";
import { offlineDatabase, storedRequest } from "../features/offline/storage";
import { readCache, writeCache } from "./cache";
import { invalidate } from "./invalidate";
import { apiJson, isApiError, isNetworkError, isOnline } from "./transport";

export type MutationRequest = {
  readonly id: string;
  readonly method: "POST" | "PATCH" | "DELETE";
  readonly path: string;
  readonly body?: unknown;
};
export type QueuedMutation = { readonly queued: true; readonly id: string };

const recordSchema = z.object({
  sequence: z.number(),
  base: TransactionSchema.optional(),
  request: z.object({
    id: z.string(),
    method: z.enum(["POST", "PATCH", "DELETE"]),
    path: z.string(),
    body: z.unknown().optional(),
  }),
});
type Record = z.infer<typeof recordSchema>;
let pending: readonly Record[] = [];
let hydration: Promise<void> | undefined;
let flushing: Promise<void> | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

async function refresh(): Promise<void> {
  pending = z.array(recordSchema).parse(await storedRequest("outbox", "readonly", (store) => store.getAll()));
  for (const listener of listeners) listener();
  invalidate("transactions");
}
function ready(): Promise<void> {
  hydration ??= refresh().catch((error: unknown) => {
    hydration = undefined;
    throw error;
  });
  return hydration;
}

async function send(req: MutationRequest): Promise<unknown> {
  const result = await apiJson(req.path, {
    method: req.method,
    json: req.body,
    headers: { "Idempotency-Key": req.id },
  });
  const transaction = TransactionSchema.safeParse(result);
  if (transaction.success) {
    await writeCache(`transactions/${encodeURIComponent(transaction.data.id)}`, transaction.data).catch(() =>
      console.warn("transaction_cache_write_failed"),
    );
  }
  return result;
}

async function queue(req: MutationRequest): Promise<QueuedMutation> {
  const db = await offlineDatabase();
  const target = /^transactions\/([^/]+)(?:\/restore)?$/.exec(req.path);
  const base = target?.[1] ? TransactionSchema.safeParse(await readCache(`transactions/${target[1]}`)) : null;
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("outbox", "readwrite");
    const store = transaction.objectStore("outbox");
    const existing = store.index("request_id").getKey(req.id);
    existing.onsuccess = () => {
      if (existing.result === undefined) store.add({ request: req, ...(base?.success ? { base: base.data } : {}) });
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
  await refresh();
  return { queued: true, id: req.id };
}

/** Retain request IDs across a lost response so the server can replay its idempotency result. */
export async function sendMutation(req: MutationRequest): Promise<unknown> {
  await ready();
  if (!isOnline() || pending.length > 0) return queue(req);
  try {
    return await send(req);
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    return queue(req);
  }
}

export function usePendingCount(): number {
  useEffect(() => {
    ready().catch((error: unknown) => {
      console.warn("outbox hydration failed", error);
      toast({ message: "동기화 대기 기록을 열지 못했어요" });
    });
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => pending.length,
    () => 0,
  );
}

/** Called after session verification. Single flight also prevents timer/online/manual replay overlap. */
export function flushOutbox(): Promise<void> {
  flushing ??= (async () => {
    await ready();
    while (pending.length > 0 && isOnline()) {
      const head = pending[0];
      if (!head) break;
      try {
        await send(head.request);
      } catch (error) {
        if (isNetworkError(error)) break;
        if (!isApiError(error)) throw error;
        if (![400, 404, 409, 422].includes(error.status)) break;
        toast({ message: `동기화하지 못한 기록을 제외했어요: ${error.message || error.code}` });
      }
      await storedRequest("outbox", "readwrite", (store) => store.delete(head.sequence));
      await refresh();
      for (const prefix of ["stats", "assets", "budgets"]) invalidate(prefix);
    }
  })().finally(() => {
    flushing = undefined;
  });
  return flushing;
}

/** Project queued changes on transaction reads without altering other GET contracts. */
export function applyOverlay<T>(key: string, data: T): T {
  return overlayTransactions(
    key,
    data,
    pending.map((item) => ({ ...item.request, ...(item.base ? { base: item.base } : {}) })),
  );
}

/** Row badge seam: uses the create body's real transaction ID, never the request ID. */
export function isPendingTransaction(id: string): boolean {
  return pending.some(({ request }) => {
    const path = `transactions/${encodeURIComponent(id)}`;
    if (request.path === path || request.path === `${path}/restore`) return true;
    if (request.method !== "POST" || request.path !== "transactions") return false;
    const body = z.object({ id: z.string() }).safeParse(request.body);
    return body.success && body.data.id === id;
  });
}
