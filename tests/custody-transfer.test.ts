import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { openDb } from "../server/db";
import { assetSummary, createAsset } from "../server/domain/assets";
import { statsCategories, statsSummary } from "../server/domain/stats";
import { updateTransaction } from "../server/domain/transactions";
import { getTransaction } from "../server/domain/tx-core";
import { createImporter, type Importer } from "../server/importer/run";
import { AssetInputSchema, TransactionPatchSchema } from "../shared/schema";
import { type FixtureEntry, setEntries } from "./fixtures/importer/input";

const OCTOBER = { from: "2026-10-01", to: "2026-11-01" };
const sms: FixtureEntry[] = [
  {
    id: 1,
    at: "2026-10-03T10:00:00+09:00",
    account: "2222",
    kind: "이체",
    amount: -20000,
    counterparty: "샘플가족",
    balance: 200000,
  },
  {
    id: 2,
    at: "2026-10-05T10:00:00+09:00",
    account: "2222",
    kind: "이체",
    amount: -50000,
    counterparty: "샘플가족",
    balance: 150000,
  },
  {
    id: 3,
    at: "2026-10-06T10:00:00+09:00",
    account: "2222",
    kind: "입금",
    amount: 30000,
    counterparty: "샘플가족",
    balance: 180000,
  },
];

let db: Database;
let importer: Importer;
let custodyId: string;

const rowFor = (amount: number) => {
  const row = db.query<{ id: string }, [number]>("SELECT id FROM transactions WHERE src_amount=?").get(amount);
  const transaction = row ? getTransaction(db, row.id) : null;
  if (!transaction) throw new Error(`Expected imported transaction ${amount}`);
  return transaction;
};
const balanceOf = (id: string | null) => assetSummary(db, "2026-10-31").assets.find((row) => row.id === id)?.balance;
const toCustody = (id: string) =>
  updateTransaction(
    db,
    id,
    TransactionPatchSchema.parse({ type: "transfer", to_asset_id: custodyId, category_id: null }),
  );
const fromCustody = (id: string, bankId: string | null) =>
  updateTransaction(
    db,
    id,
    TransactionPatchSchema.parse({ type: "transfer", asset_id: custodyId, to_asset_id: bankId, category_id: null }),
  );

beforeEach(async () => {
  db = openDb(":memory:");
  importer = createImporter({ db, modulePath: resolve("tests/fixtures/importer/input.ts") });
  setEntries(sms);
  expect(await importer.run()).toMatchObject({ inserted: 3, errors: [] });
  custodyId = createAsset(
    db,
    AssetInputSchema.parse({ name: "샘플보관금", kind: "other", opening_balance: 100000, opening_date: "2026-10-04" }),
  ).id;
});
afterEach(() => {
  db.close();
  setEntries([]);
});

describe("custody transfers from imported rows", () => {
  test("converted rows move the custody balance both ways and leave the bank balance unchanged", () => {
    const bankId = rowFor(-50000).asset_id;
    const bankBefore = balanceOf(bankId);
    expect(balanceOf(custodyId)).toBe(100000);

    expect(toCustody(rowFor(-50000).id).transaction).toMatchObject({
      type: "transfer",
      asset_id: bankId,
      to_asset_id: custodyId,
      category_id: null,
    });
    expect(balanceOf(custodyId)).toBe(150000);

    expect(fromCustody(rowFor(30000).id, bankId).transaction).toMatchObject({
      type: "transfer",
      asset_id: custodyId,
      to_asset_id: bankId,
      category_id: null,
    });
    expect(balanceOf(custodyId)).toBe(120000);
    expect(balanceOf(bankId)).toBe(bankBefore);
  });

  test("a converted row dated before the custody opening date does not add to its balance again", () => {
    const old = rowFor(-20000);
    const bankBefore = balanceOf(old.asset_id);
    toCustody(old.id);
    expect(getTransaction(db, old.id)).toMatchObject({ type: "transfer", to_asset_id: custodyId });
    expect(balanceOf(custodyId)).toBe(100000);
    expect(balanceOf(old.asset_id)).toBe(bankBefore);
  });

  test("converted rows leave income and expense statistics", () => {
    expect(statsSummary(db, OCTOBER)).toEqual({ income: 30000, expense: 70000, net: -40000, count: 3 });
    toCustody(rowFor(-20000).id);
    toCustody(rowFor(-50000).id);
    fromCustody(rowFor(30000).id, rowFor(30000).asset_id);
    expect(statsSummary(db, OCTOBER)).toEqual({ income: 0, expense: 0, net: 0, count: 0 });
    expect(statsCategories(db, { ...OCTOBER, type: "expense" })).toEqual({ total: 0, rows: [] });
    expect(statsCategories(db, { ...OCTOBER, type: "income" })).toEqual({ total: 0, rows: [] });
  });

  test("conversions survive a repeated SMS import and the later excel merge", async () => {
    const bankId = rowFor(-50000).asset_id;
    toCustody(rowFor(-50000).id);
    fromCustody(rowFor(30000).id, bankId);
    const custodyBefore = balanceOf(custodyId);

    expect(await importer.run()).toMatchObject({ inserted: 0, errors: [] });
    setEntries(sms.map((entry) => ({ ...entry, id: entry.id + 100, source: "excel" })));
    expect(await importer.run()).toMatchObject({ inserted: 0, errors: [] });

    expect(rowFor(-50000)).toMatchObject({
      source: "kakaobank_excel",
      type: "transfer",
      asset_id: bankId,
      to_asset_id: custodyId,
      category_id: null,
    });
    expect(rowFor(30000)).toMatchObject({
      source: "kakaobank_excel",
      type: "transfer",
      asset_id: custodyId,
      to_asset_id: bankId,
      category_id: null,
    });
    expect(rowFor(-20000)).toMatchObject({ source: "kakaobank_excel", type: "expense" });
    expect(db.query("SELECT id FROM transactions").all()).toHaveLength(3);
    expect(balanceOf(custodyId)).toBe(custodyBefore);
    expect(statsSummary(db, OCTOBER)).toMatchObject({ income: 0, expense: 20000, count: 1 });
  });
});
