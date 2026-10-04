import { TransactionListSchema } from "../../shared/schema";
import { offlineDatabase, storedRequest } from "../features/offline/storage";

export async function readCache<T>(key: string): Promise<T | undefined> {
  return storedRequest<T | undefined>("cache", "readonly", (store) => store.get(key));
}

export async function writeCache(key: string, value: unknown): Promise<void> {
  const list = key.split("?")[0] === "transactions" ? TransactionListSchema.safeParse(value) : null;
  const db = await offlineDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("cache", "readwrite");
    const store = transaction.objectStore("cache");
    store.put(value, key);
    if (list?.success) {
      for (const row of list.data.items) store.put(row, `transactions/${encodeURIComponent(row.id)}`);
    }
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function clearCache(): Promise<void> {
  await storedRequest("cache", "readwrite", (store) => store.clear());
}

/**
 * Last-known auth flag (AM-10). A boolean, never a credential. localStorage keeps it across reloads so an
 * offline open can show the shell instead of the login screen; storage may be unavailable (private mode),
 * in which case the app simply behaves as "never signed in".
 */
const LAST_AUTH_KEY = "ledger-app:last-auth";

export function readLastAuth(): boolean {
  try {
    return localStorage.getItem(LAST_AUTH_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeLastAuth(authenticated: boolean): void {
  try {
    if (authenticated) localStorage.setItem(LAST_AUTH_KEY, "1");
    else localStorage.removeItem(LAST_AUTH_KEY);
  } catch (error) {
    console.warn("last-auth flag not persisted", error);
  }
}
