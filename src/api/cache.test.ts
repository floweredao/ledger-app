import { beforeEach, expect, test } from "bun:test";
import "fake-indexeddb/auto";
import { clearCache, readCache, writeCache } from "./cache";

beforeEach(async () => {
  await clearCache();
});

test("cached responses are persisted by URL as isolated structured clones", async () => {
  // Given
  const row = { amount: 4500 };
  const response = { items: [row] };
  const key = "transactions?from=2026-10-01&to=2026-10-31";
  // When
  await writeCache(key, response);
  row.amount = 999;
  // Then
  expect(await readCache<unknown>(key)).toEqual({ items: [{ amount: 4500 }] });
  expect(await readCache("transactions?from=2026-09-01")).toBeUndefined();
});

test("the ledger-app cache store survives a separate database connection", async () => {
  // Given
  await writeCache("settings", { month_start_day: 7 });
  // When
  const stored = await new Promise<unknown>((resolve, reject) => {
    const request = indexedDB.open("ledger-app");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("cache")) {
        db.close();
        resolve(undefined);
        return;
      }
      const transaction = db.transaction("cache", "readonly");
      const get = transaction.objectStore("cache").get("settings");
      transaction.oncomplete = () => {
        db.close();
        resolve(get.result);
      };
      transaction.onabort = () => reject(transaction.error);
    };
  });
  // Then
  expect(stored).toEqual({ month_start_day: 7 });
});

test("clearing cached reads removes all query variants", async () => {
  // Given
  await writeCache("transactions?q=샘플", { count: 1 });
  await writeCache("settings", { month_start_day: 1 });
  // When
  await clearCache();
  // Then
  expect(await readCache("settings")).toBeUndefined();
  expect(await readCache("transactions?q=샘플")).toBeUndefined();
});

test("cached transaction pages make each visible row available for offline editing", async () => {
  const transaction = {
    id: "offline-row",
    type: "expense",
    occurred_at: "2026-10-03T12:00:00+09:00",
    amount: 4500,
    is_refund: false,
    currency: "KRW",
    foreign_amount: null,
    krw_status: "exact",
    asset_id: null,
    to_asset_id: null,
    category_id: null,
    merchant: "샘플카페",
    merchant_key: "샘플카페",
    memo: "",
    source: "manual",
    source_key: null,
    src_account: null,
    src_amount: null,
    src_at: null,
    hidden: false,
    hidden_reason: null,
    user_locked: [],
    recurring_rule_id: null,
    deleted_at: null,
    created_at: "2026-10-03T12:00:00+09:00",
    updated_at: "2026-10-03T12:00:00+09:00",
  };
  await writeCache("transactions?from=2026-10-01&to=2026-10-31", {
    items: [transaction],
    totals: { income: 0, expense: 4500, net: -4500, count: 1 },
    next_cursor: null,
  });
  expect(await readCache("transactions/offline-row")).toMatchObject({ id: "offline-row", amount: 4500 });
});
