import { expect, test } from "bun:test";
import type { Transaction, TransactionList } from "../../../shared/schema";
import type { MutationRequest } from "../../api/outbox";
import { overlayTransactions } from "./overlay";

const row: Transaction = {
  id: "row-1",
  type: "expense",
  occurred_at: "2026-10-03T12:00:00+09:00",
  amount: 1000,
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
const list: TransactionList = {
  items: [row],
  totals: { income: 0, expense: 1000, net: -1000, count: 1 },
  next_cursor: null,
};
const patch: MutationRequest = { id: "patch", method: "PATCH", path: "transactions/row-1", body: { amount: 500 } };
const deletion: MutationRequest = { id: "delete", method: "DELETE", path: "transactions/row-1" };
const restore: MutationRequest = { id: "restore", method: "POST", path: "transactions/row-1/restore" };

test("uncategorized projection includes only unassigned queued creates", () => {
  const empty: TransactionList = { items: [], totals: { income: 0, expense: 0, net: 0, count: 0 }, next_cursor: null };
  const create = (id: string, category_id: string | null): MutationRequest => ({
    id,
    method: "POST",
    path: "transactions",
    body: { id, type: "expense", amount: 4500, occurred_at: row.occurred_at, category_id, merchant: "테스트마트" },
  });
  const unassigned = "019a0000-0000-7000-8000-000000000002";
  const assigned = "019a0000-0000-7000-8000-000000000003";
  const projected = overlayTransactions("transactions?category_id=uncategorized", empty, [
    create(unassigned, null),
    create(assigned, "category-food"),
  ]);
  expect(projected.items.map((item) => item.id)).toEqual([unassigned]);
  expect(projected.totals).toEqual({ income: 0, expense: 4500, net: -4500, count: 1 });
});

test("uncategorized projection moves pending category edits into and out of the filter", () => {
  const empty: TransactionList = { items: [], totals: { income: 0, expense: 0, net: 0, count: 0 }, next_cursor: null };
  const entering = overlayTransactions("transactions?category_id=uncategorized", empty, [
    { ...patch, body: { category_id: null }, base: { ...row, category_id: "category-food" } },
  ]);
  expect(entering.items).toMatchObject([{ id: row.id, category_id: null }]);
  expect(entering.totals.count).toBe(1);
  const leaving = overlayTransactions("transactions?category_id=uncategorized", list, [
    { ...patch, body: { category_id: "category-food" } },
  ]);
  expect(leaving.items).toEqual([]);
  expect(leaving.totals.count).toBe(0);
  expect(
    overlayTransactions(
      "transactions?category_id=parent-food",
      {
        ...list,
        items: [{ ...row, category_id: "child-food" }],
      },
      [patch],
    ).items[0]?.amount,
  ).toBe(500);
});

test("pending patches update cached rows and totals without mutating the cache", () => {
  const projected = overlayTransactions("transactions", list, [patch]);
  expect(projected.items[0]?.amount).toBe(500);
  expect(projected.totals).toEqual({ income: 0, expense: 500, net: -500, count: 1 });
  expect(row.amount).toBe(1000);
});

test("queued delete and undo are applied in order", () => {
  expect(overlayTransactions("transactions", list, [patch, deletion]).items).toEqual([]);
  const restored = overlayTransactions("transactions", list, [patch, deletion, restore]);
  expect(restored.items[0]?.amount).toBe(500);
  expect(restored.totals.count).toBe(1);
});

test("a queued create can be read and edited offline before it has a server record", () => {
  const create: MutationRequest = {
    id: "create",
    method: "POST",
    path: "transactions",
    body: {
      id: "019a0000-0000-7000-8000-000000000002",
      type: "expense",
      amount: 4500,
      occurred_at: row.occurred_at,
      merchant: "테스트마트",
    },
  };
  const edit: MutationRequest = {
    id: "edit",
    method: "PATCH",
    path: "transactions/019a0000-0000-7000-8000-000000000002",
    body: { amount: 5000 },
  };
  expect(
    overlayTransactions("transactions/019a0000-0000-7000-8000-000000000002", undefined, [create, edit]),
  ).toMatchObject({
    id: "019a0000-0000-7000-8000-000000000002",
    amount: 5000,
    merchant: "테스트마트",
  });
  const empty: TransactionList = { items: [], totals: { income: 0, expense: 0, net: 0, count: 0 }, next_cursor: null };
  const removed = overlayTransactions("transactions", empty, [
    create,
    edit,
    { ...deletion, path: "transactions/019a0000-0000-7000-8000-000000000002" },
  ]);
  expect(removed.items).toEqual([]);
  expect(removed.totals.count).toBe(0);
});

test("moving a queued edit out of the cached date range removes its old contribution", () => {
  const move = { ...patch, body: { occurred_at: "2026-10-31T15:00:00Z" } };
  const projected = overlayTransactions("transactions?from=2026-10-01&to=2026-10-31", list, [move]);
  expect(projected.items).toEqual([]);
  expect(projected.totals.expense).toBe(0);
  expect(overlayTransactions("transactions/row-1", row, [move]).occurred_at).toBe("2026-11-01T00:00:00+09:00");
});

test("queued undo restores a cached deleted row even when the list is now empty", () => {
  const empty: TransactionList = { items: [], totals: { income: 0, expense: 0, net: 0, count: 0 }, next_cursor: null };
  const projected = overlayTransactions("transactions", empty, [
    {
      ...restore,
      base: { ...row, deleted_at: "2026-10-03T13:00:00+09:00" },
    },
  ]);
  expect(projected.items).toMatchObject([{ id: row.id, deleted_at: null, amount: 1000 }]);
  expect(projected.totals).toEqual({ income: 0, expense: 1000, net: -1000, count: 1 });
});
