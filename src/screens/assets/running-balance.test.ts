import { describe, expect, test } from "bun:test";
import { runningBalances } from "./running-balance";

type Row = Parameters<typeof runningBalances>[0]["items"][number];
const row = (id: string, fields: Partial<Row>): Row => ({
  id,
  type: "expense",
  amount: 1000,
  is_refund: false,
  asset_id: "bank",
  to_asset_id: null,
  occurred_at: "2026-10-10T12:00:00+09:00",
  hidden: false,
  ...fields,
});

describe("runningBalances", () => {
  test("newest row carries the current balance and older rows step back through each record", () => {
    const balances = runningBalances({
      balance: 50000,
      accountIds: new Set(["bank"]),
      openingDate: null,
      items: [
        row("expense", { amount: 4800 }),
        row("income", { type: "income", amount: 30000 }),
        row("refund", { amount: 1000, is_refund: true }),
        row("out", { type: "transfer", amount: 10000, to_asset_id: "family" }),
        row("in", { type: "transfer", amount: 2000, asset_id: "cash", to_asset_id: "bank" }),
      ],
    });
    expect([...balances.entries()]).toEqual([
      ["expense", 50000],
      ["income", 54800],
      ["refund", 24800],
      ["out", 23800],
      ["in", 33800],
    ]);
  });

  test("a check card's spending moves its linked account, and a transfer between them nets to zero", () => {
    const balances = runningBalances({
      balance: 10000,
      accountIds: new Set(["bank", "check"]),
      openingDate: null,
      items: [
        row("card", { asset_id: "check", amount: 3000 }),
        row("self", { type: "transfer", asset_id: "bank", to_asset_id: "check", amount: 500 }),
        row("older", { amount: 1 }),
      ],
    });
    expect(balances.get("card")).toBe(10000);
    expect(balances.get("self")).toBe(13000);
    expect(balances.get("older")).toBe(13000);
  });

  test("hidden rows and rows before the opening date get no balance and do not move it", () => {
    const balances = runningBalances({
      balance: 7000,
      accountIds: new Set(["bank"]),
      openingDate: "2026-10-05",
      items: [
        row("hidden", { hidden: true, amount: 999 }),
        row("kept", { amount: 2000 }),
        row("before", { amount: 5000, occurred_at: "2026-10-04T12:00:00+09:00" }),
      ],
    });
    expect(balances.has("hidden")).toBe(false);
    expect(balances.get("kept")).toBe(7000);
    expect(balances.has("before")).toBe(false);
  });
});
