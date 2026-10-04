import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../server/db";

const EXPECTED_CATEGORIES = 43;
let dir = "";
const opened: Database[] = [];
const open = () => {
  const db = openDb(join(dir, "ledger.sqlite"));
  opened.push(db);
  return db;
};
const count = (db: Database, sql: string) => db.query<{ n: number }, []>(sql).get()?.n ?? -1;

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("openDb", () => {
  test("migrates a new file to schema user_version 2", () => {
    dir = mkdtempSync(join(tmpdir(), "ledger-db-"));
    const db = open();
    expect(db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version).toBe(2);
    expect(db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get()?.foreign_keys).toBe(1);
  });

  test("migrates existing v1 rows unchanged and reopens idempotently without reseeding", () => {
    dir = mkdtempSync(join(tmpdir(), "ledger-db-"));
    const path = join(dir, "ledger.sqlite");
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE assets(id TEXT PRIMARY KEY, name TEXT NOT NULL, opening_balance INTEGER NOT NULL);
      CREATE TABLE transactions(id TEXT PRIMARY KEY, asset_id TEXT REFERENCES assets(id), amount INTEGER);
      INSERT INTO assets VALUES('legacy-asset','테스트계좌',12345);
      INSERT INTO transactions VALUES('legacy-tx','legacy-asset',678);
      PRAGMA user_version=1;
    `);
    const transactions = legacy.query("SELECT * FROM transactions").all();
    legacy.close();
    for (let attempt = 0; attempt < 2; attempt++) {
      const db = openDb(path);
      try {
        expect(db.query("SELECT * FROM assets").all()).toEqual([
          { id: "legacy-asset", name: "테스트계좌", opening_balance: 12345, opening_date: null },
        ]);
        expect(db.query("SELECT * FROM transactions").all()).toEqual(transactions);
        expect(db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version).toBe(2);
      } finally {
        db.close();
      }
    }
  });

  test("seeds categories, the cash asset and settings once even when opened twice", () => {
    dir = mkdtempSync(join(tmpdir(), "ledger-db-"));
    openDb(join(dir, "ledger.sqlite")).close();
    const db = open();
    expect(count(db, "SELECT count(*) AS n FROM categories")).toBe(EXPECTED_CATEGORIES);
    expect(count(db, "SELECT count(*) AS n FROM categories WHERE type='income'")).toBe(8);
    expect(count(db, "SELECT count(*) AS n FROM assets WHERE kind='cash' AND name='현금'")).toBe(1);
    expect(db.query("SELECT key, value FROM settings ORDER BY key").all()).toEqual([
      { key: "default_asset_id", value: "null" },
      { key: "month_start_day", value: "1" },
      { key: "owner_name", value: '""' },
      { key: "theme", value: '"system"' },
    ]);
  });

  test("gives transactions the importer-owned src_account, src_amount and src_at columns", () => {
    dir = mkdtempSync(join(tmpdir(), "ledger-db-"));
    const columns = open()
      .query<{ name: string; type: string }, []>("PRAGMA table_info(transactions)")
      .all()
      .map((column) => `${column.name}:${column.type}`);
    expect(columns).toEqual(expect.arrayContaining(["src_account:TEXT", "src_amount:INTEGER", "src_at:TEXT"]));
  });

  test("rejects a negative amount and a duplicate source_key", () => {
    dir = mkdtempSync(join(tmpdir(), "ledger-db-"));
    const db = open();
    const insert = db.query(
      "INSERT INTO transactions(id,type,occurred_at,amount,source,source_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
    );
    const at = "2026-10-04T12:00:00+09:00";
    expect(() => insert.run("t1", "expense", at, -1, "manual", null, at, at)).toThrow();
    insert.run("t2", "expense", at, 4500, "kakaobank_sms", "sms:1", at, at);
    expect(() => insert.run("t3", "expense", at, 4500, "kakaobank_sms", "sms:1", at, at)).toThrow();
  });
});
