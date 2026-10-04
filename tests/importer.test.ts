import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, watch, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { openDb } from "../server/db";
import { getTransaction, patchTransaction, softDelete } from "../server/domain/tx-core";
import { createImporter, type Importer } from "../server/importer/run";
import { startImportWatcher } from "../server/importer/watch";
import { merchantKey } from "../shared/merchant";
import { type FixtureEntry, setEntries } from "./fixtures/importer/input";

const at = (minute: number) => `2026-10-03T10:${String(minute).padStart(2, "0")}:00+09:00`;
const entry = (overrides: Partial<FixtureEntry> = {}): FixtureEntry => ({
  id: 1,
  at: at(0),
  account: "2222",
  kind: "체크카드결제",
  amount: -4500,
  counterparty: "샘플카페",
  balance: 95500,
  ...overrides,
});

let db: Database;
let importer: Importer;
let dir: string;
const rows = () => db.query<{ id: string }, []>("SELECT id FROM transactions ORDER BY src_at,id").all();
const transaction = (index = 0) => {
  const row = rows()[index];
  if (!row) throw new Error("Expected imported transaction");
  const result = getTransaction(db, row.id);
  if (!result) throw new Error("Expected transaction");
  return result;
};
const category = (name: string, type = "expense") => {
  const row = db
    .query<{ id: string }, [string, string]>("SELECT id FROM categories WHERE name=? AND type=?")
    .get(name, type);
  if (!row) throw new Error("Expected seeded category");
  return row.id;
};
const state = (key: string): unknown => {
  const row = db.query<{ value: string }, [string]>("SELECT value FROM import_state WHERE key=?").get(key);
  return row ? JSON.parse(row.value) : null;
};
const bounded = async <T>(promise: Promise<T>, timeoutMs = 5000): Promise<T> => {
  const deadline = setTimeout(() => reject(new Error("Signal deadline exceeded")), timeoutMs);
  let reject: (reason: Error) => void = () => {};
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, fail) => {
        reject = fail;
      }),
    ]);
  } finally {
    clearTimeout(deadline);
  }
};

beforeEach(() => {
  db = openDb(":memory:");
  dir = mkdtempSync(join(tmpdir(), "ledger-importer-"));
  importer = createImporter({ db, modulePath: resolve("tests/fixtures/importer/input.ts") });
  setEntries([]);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  setEntries([]);
});

describe("KakaoBank importer", () => {
  test("inserts once and ignores renumbered excel exports with account-scoped keys", async () => {
    setEntries([entry({ source: "excel" }), entry({ source: "excel", account: "3333" })]);
    expect(await importer.run()).toMatchObject({ inserted: 2, errors: [] });
    setEntries([entry({ source: "excel", id: 90 }), entry({ source: "excel", id: 91, account: "3333" })]);
    expect(await importer.run()).toMatchObject({ inserted: 0, skipped: 2 });
    expect(rows()).toHaveLength(2);
  });

  test("skips reassigned SMS ids using immutable minute amount and balance", async () => {
    setEntries([entry()]);
    await importer.run();
    setEntries([entry({ id: 99, at: "2026-10-03T10:00:45+09:00" })]);
    expect(await importer.run()).toMatchObject({ inserted: 0, skipped: 1 });
  });

  for (const field of ["amount", "asset_id", "occurred_at", "memo", "deleted_at"] as const) {
    test(`merges excel in place after owner changes ${field}`, async () => {
      setEntries([entry()]);
      await importer.run();
      const original = transaction();
      const cash = db.query<{ id: string }, []>("SELECT id FROM assets WHERE kind='cash'").get();
      if (!cash) throw new Error("Expected cash");
      switch (field) {
        case "amount":
          patchTransaction(db, original.id, { amount: 7000 });
          break;
        case "asset_id":
          patchTransaction(db, original.id, { asset_id: cash.id });
          break;
        case "occurred_at":
          patchTransaction(db, original.id, { occurred_at: at(50) });
          break;
        case "memo":
          patchTransaction(db, original.id, { memo: "owner memo" });
          break;
        case "deleted_at":
          softDelete(db, original.id);
          break;
      }
      const edited = transaction();
      setEntries([entry({ source: "excel", id: 20, at: at(2) })]);
      expect(await importer.run()).toMatchObject({ inserted: 0, merged: 1 });
      expect(rows()).toHaveLength(1);
      expect(transaction()).toMatchObject({
        id: original.id,
        source: "kakaobank_excel",
        [field]: edited[field],
        user_locked: edited.user_locked,
      });
    });
  }

  test("chooses balance before amount and preserves USD metadata on exact excel merge", async () => {
    setEntries([
      entry({ id: 1, at: at(0), amount: -14000, balance: 86000 }),
      entry({ id: 2, at: at(2), amount: -10, currency: "USD", balance: 72000 }),
    ]);
    await importer.run();
    const usd = transaction(1);
    setEntries([entry({ source: "excel", at: at(3), amount: -14000, balance: 72000 })]);
    expect(await importer.run()).toMatchObject({ merged: 1, inserted: 0 });
    expect(getTransaction(db, usd.id)).toMatchObject({
      currency: "USD",
      foreign_amount: 10,
      amount: 14000,
      krw_status: "exact",
      src_amount: -14000,
    });
    expect(transaction().source).toBe("kakaobank_sms");
  });

  test("uses nearest immutable amount fallback without double merging", async () => {
    setEntries([entry({ id: 1, at: at(0), balance: null }), entry({ id: 2, at: at(8), balance: null })]);
    await importer.run();
    const ids = rows().map((row) => row.id);
    setEntries([
      entry({ source: "excel", at: at(1), balance: 95500 }),
      entry({ source: "excel", at: at(7), balance: 91000 }),
    ]);
    expect(await importer.run()).toMatchObject({ merged: 2, inserted: 0 });
    expect(rows().map((row) => row.id)).toEqual(ids);
  });

  test("hides zero failures before currency inference", async () => {
    setEntries([entry({ amount: 0, currency: "USD", kind: "해외결제 실패", balance: 80000 })]);
    expect(await importer.run()).toMatchObject({ hidden: 1 });
    expect(transaction()).toMatchObject({
      amount: 0,
      hidden: true,
      hidden_reason: "card_failed",
      krw_status: "exact",
      foreign_amount: null,
    });
  });

  test("uses refund original category even when cancellation is in the merchant", async () => {
    setEntries([entry()]);
    await importer.run();
    patchTransaction(db, transaction().id, { category_id: category("온라인") });
    setEntries([entry(), entry({ id: 2, at: at(1), amount: 4500, counterparty: "샘플카페 환불", balance: 100000 })]);
    await importer.run();
    expect(transaction(1)).toMatchObject({ type: "expense", is_refund: true, category_id: category("온라인") });
  });

  test("infers foreign KRW only within the conversion bounds", async () => {
    setEntries([
      entry({ amount: 100000, kind: "입금", balance: 100000 }),
      entry({ id: 2, at: at(1), amount: -10, currency: "USD", balance: 86000 }),
      entry({ id: 3, at: at(2), amount: -10, currency: "USD", balance: 85000 }),
    ]);
    await importer.run();
    expect(transaction(1)).toMatchObject({ amount: 14000, foreign_amount: 10, krw_status: "inferred" });
    expect(transaction(2)).toMatchObject({ amount: 0, foreign_amount: 10, krw_status: "pending" });
  });

  test("matches learned rules by type and beats the dictionary", async () => {
    db.query("INSERT INTO merchant_rules VALUES(?,?,?,?)").run(
      merchantKey("샘플카페"),
      category("온라인"),
      "expense",
      at(0),
    );
    db.query("INSERT INTO merchant_rules VALUES(?,?,?,?)").run(
      merchantKey("샘플카페"),
      category("급여", "income"),
      "income",
      at(0),
    );
    setEntries([entry(), entry({ id: 2, at: at(1), amount: 1000, kind: "입금" })]);
    await importer.run();
    expect(transaction().category_id).toBe(category("온라인"));
    expect(transaction(1).category_id).toBe(category("급여", "income"));
  });

  test("preserves fractional foreign source amounts without rounding", async () => {
    setEntries([entry({ amount: -10.5, currency: "USD", balance: 85300 })]);
    expect(await importer.run()).toMatchObject({ inserted: 1, errors: [] });
    expect(transaction()).toMatchObject({ src_amount: -10.5, foreign_amount: 10.5, krw_status: "pending" });
  });

  test("reclassifies self transfers in both directions while keeping locked categories", async () => {
    setEntries([
      entry({ counterparty: "홍길동", kind: "이체" }),
      entry({ id: 2, at: at(1), amount: 1000, counterparty: "홍길동", kind: "입금" }),
    ]);
    await importer.run();
    patchTransaction(db, transaction().id, { category_id: category("온라인") });
    db.query("UPDATE settings SET value=? WHERE key='owner_name'").run(JSON.stringify("홍길동"));
    expect(importer.reclassify()).toBe(2);
    const bank = db.query<{ id: string }, []>("SELECT id FROM assets WHERE external_ref='kakaobank:2222'").get();
    expect(transaction()).toMatchObject({ type: "transfer", asset_id: bank?.id, category_id: category("온라인") });
    expect(transaction(1)).toMatchObject({ type: "transfer", to_asset_id: bank?.id });
    db.query("UPDATE settings SET value='\"\"' WHERE key='owner_name'").run();
    expect(importer.reclassify()).toBe(2);
    expect(transaction(1)).toMatchObject({ type: "income", to_asset_id: null });
  });

  test("records check card payments on the bank account with its opening balance and newest reported state", async () => {
    setEntries([entry(), entry({ id: 2, at: at(1), amount: 1000, kind: "입금", balance: 96500 })]);
    await importer.run();
    const bank = db
      .query<{ id: string; opening_balance: number }, []>(
        "SELECT id,opening_balance FROM assets WHERE external_ref='kakaobank:2222'",
      )
      .get();
    expect(bank?.opening_balance).toBe(100000);
    const computed = db
      .query<{ balance: number }, []>(
        `SELECT a.opening_balance + COALESCE(SUM(
				CASE WHEN t.type='income' THEN t.amount
				WHEN t.type='expense' AND t.is_refund=1 THEN t.amount
				WHEN t.type='expense' THEN -t.amount ELSE 0 END),0) AS balance
			 FROM assets a LEFT JOIN transactions t
			 ON t.asset_id=a.id OR t.asset_id IN (SELECT id FROM assets WHERE linked_asset_id=a.id)
			 WHERE a.external_ref='kakaobank:2222' AND t.hidden=0 AND t.deleted_at IS NULL`,
      )
      .get();
    expect(computed?.balance).toBe(96500);
    expect(state("reported:kakaobank:2222")).toEqual({ balance: 96500, at: at(1) });
    expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM assets WHERE kind='check_card'").get()?.n).toBe(0);
    expect(transaction()).toMatchObject({ type: "expense", asset_id: bank?.id });
  });

  test("shares an active run promise and commits only once", async () => {
    const entered = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    setEntries([entry()], gate.promise, entered.resolve);
    const first = importer.run();
    await bounded(entered.promise);
    const second = importer.run();
    expect(second).toBe(first);
    gate.resolve();
    expect(await first).toMatchObject({ inserted: 1 });
    expect(await second).toMatchObject({ inserted: 1 });
    expect(rows()).toHaveLength(1);
  });

  test("rejects invalid source atomically and records safe errors then recovers", async () => {
    setEntries([entry(), { ...entry(), amount: "PRIVATE_INPUT_SENTINEL" }]);
    const result = await importer.run();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_INPUT_SENTINEL");
    expect(rows()).toHaveLength(0);
    expect(state("last_error")).toBeTruthy();
    setEntries([entry()]);
    expect(await importer.run()).toMatchObject({ inserted: 1, errors: [] });
    expect(state("last_error")).toBeNull();
  });

  test("reloads faithful file fixture data without module cache busting", async () => {
    const oldSms = process.env.FAKE_LEDGER_FILE;
    const oldExcel = process.env.FAKE_LEDGER_EXCEL_FILE;
    try {
      process.env.FAKE_LEDGER_FILE = join(dir, "sms.jsonl");
      process.env.FAKE_LEDGER_EXCEL_FILE = join(dir, "excel.jsonl");
      const fileImporter = createImporter({ db, modulePath: resolve("tests/fixtures/fake-ledger.ts") });
      expect(await fileImporter.run()).toMatchObject({ inserted: 0, errors: [] });
      writeFileSync(process.env.FAKE_LEDGER_FILE, JSON.stringify(entry({ account: "1111" })));
      expect(await fileImporter.run()).toMatchObject({ inserted: 1 });
      expect(transaction().src_account).toBe("2222");
      writeFileSync(process.env.FAKE_LEDGER_EXCEL_FILE, JSON.stringify(entry({ source: "excel", at: at(1) })));
      expect(await fileImporter.run()).toMatchObject({ merged: 1 });
      expect(rows()).toHaveLength(1);
    } finally {
      if (oldSms === undefined) delete process.env.FAKE_LEDGER_FILE;
      else process.env.FAKE_LEDGER_FILE = oldSms;
      if (oldExcel === undefined) delete process.env.FAKE_LEDGER_EXCEL_FILE;
      else process.env.FAKE_LEDGER_EXCEL_FILE = oldExcel;
    }
  });

  test("watcher imports real file events without concurrent runs", async () => {
    const sourcePath = join(dir, "sms.jsonl");
    writeFileSync(sourcePath, "{}\n");
    const ready = Promise.withResolvers<void>();
    const initial = Promise.withResolvers<void>();
    const releaseInitial = Promise.withResolvers<void>();
    const requested = Promise.withResolvers<void>();
    const complete = Promise.withResolvers<void>();
    let active = 0;
    let maximum = 0;
    let count = 0;
    let probing = true;
    const observed: Importer = {
      reclassify: importer.reclassify,
      run: async () => {
        active++;
        maximum = Math.max(maximum, active);
        count++;
        const result = await importer.run();
        if (count === 1) {
          initial.resolve();
          await releaseInitial.promise;
        }
        active--;
        if (result.inserted === 1) complete.resolve();
        return result;
      },
    };
    const stop = startImportWatcher({
      importer: observed,
      dir,
      intervalMs: 60000,
      watchDirectory: (path, listener) =>
        watch(path, (event, filename) => {
          listener(event, filename);
          if (filename === "ready.cursor") {
            probing = false;
            ready.resolve();
          }
        }),
      schedule: (callback, delay) =>
        setTimeout(() => {
          callback();
          requested.resolve();
        }, delay),
    });
    // Bun/macOS has no ready event. Keep issuing asynchronous sentinel I/O until
    // this very watcher acknowledges it; neither a write nor initial import is
    // readiness. Cursor events still traverse the real production filter.
    const probe = (async () => {
      while (probing) await writeFile(join(dir, "ready.cursor"), "ready\n");
    })();
    try {
      await bounded(Promise.all([ready.promise, initial.promise, probe]));
      setEntries([entry()]);
      writeFileSync(sourcePath, `${JSON.stringify(entry())}\n`);
      // Observe the actual debounce callback, not elapsed time. The initial
      // import stays open until the real file event requests another run.
      await bounded(requested.promise, 10000);
      expect(count).toBe(1);
      expect(active).toBe(1);
      releaseInitial.resolve();
      await bounded(complete.promise, 10000);
      expect(rows()).toHaveLength(1);
      expect(maximum).toBe(1);
      expect(count).toBe(2);
    } finally {
      probing = false;
      stop();
      releaseInitial.resolve();
      await probe;
    }
  }, 15000);
});
