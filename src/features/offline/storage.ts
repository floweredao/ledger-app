/** Cache and outbox share one schema upgrade and use transaction completion as the durability signal. */
let connection: Promise<IDBDatabase> | undefined;

export function offlineDatabase(): Promise<IDBDatabase> {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("ledger-app", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("cache");
      const outbox = db.createObjectStore("outbox", { keyPath: "sequence", autoIncrement: true });
      outbox.createIndex("request_id", "request.id", { unique: true });
    };
    request.onerror = () => {
      connection = undefined;
      reject(request.error);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        connection = undefined;
      };
      resolve(db);
    };
  });
  return connection;
}

export async function storedRequest<T>(
  storeName: "cache" | "outbox",
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await offlineDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = run(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error ?? request.error);
    transaction.onerror = () => reject(transaction.error ?? request.error);
  });
}
