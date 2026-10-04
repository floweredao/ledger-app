import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { Hono } from "hono";
import { openDb } from "../server/db";
import { insertTransaction, softDelete } from "../server/domain/tx-core";
import { type AppBindings, onError } from "../server/http";
import { assetsRoutes } from "../server/routes/assets";
import { AssetSchema, AssetSummarySchema, TransactionInputSchema, TransactionSchema } from "../shared/schema";
import type { AuthedInit } from "./helpers";

let app: { readonly db: ReturnType<typeof openDb> };
let request: (path: string, init?: AuthedInit) => Promise<Response>;
beforeEach(() => {
  setSystemTime(new Date("2026-03-15T12:00:00+09:00"));
  app = { db: openDb(":memory:") };
  const routes = new Hono<AppBindings>();
  routes.onError(onError);
  routes.use("*", async (c, next) => {
    c.set("db", app.db);
    await next();
  });
  routes.route("/api/v1", assetsRoutes);
  request = async (path, { body, ...init } = {}) =>
    routes.request(path, {
      ...init,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
});
afterEach(() => {
  app.db.close();
  setSystemTime();
});

async function asset(body: unknown) {
  const response = await request("/api/v1/assets", { method: "POST", body });
  expect(response.status).toBe(201);
  return AssetSchema.parse(await response.json());
}
async function summary() {
  const response = await request("/api/v1/assets/summary");
  expect(response.status).toBe(200);
  return AssetSummarySchema.parse(await response.json());
}
function tx(assetId: string, amount: number, occurredAt = "2026-03-15T10:00:00+09:00", extra = {}) {
  return insertTransaction(
    app.db,
    TransactionInputSchema.parse({
      type: "expense",
      asset_id: assetId,
      amount,
      occurred_at: occurredAt,
      merchant: "테스트마트",
      ...extra,
    }),
  );
}
async function card(settlementDay = 14, paymentDay = 1) {
  const bank = await asset({ name: "테스트계좌", kind: "bank", opening_balance: 1000000 });
  const credit = await asset({
    name: "샘플카드",
    kind: "credit_card",
    linked_asset_id: bank.id,
    settlement_day: settlementDay,
    payment_day: paymentDay,
    performance_target: 300000,
  });
  return { bank, credit };
}

describe("assets CRUD and validation", () => {
  test("preserves unspecified balance, group and visibility when renaming", async () => {
    const created = await asset({
      name: "샘플계좌",
      kind: "bank",
      opening_balance: 12345,
      group_name: "저축",
      hidden: true,
    });
    const response = await request(`/api/v1/assets/${created.id}`, {
      method: "PATCH",
      body: { name: "테스트계좌" },
    });
    expect(response.status).toBe(200);
    expect(AssetSchema.parse(await response.json())).toMatchObject({
      name: "테스트계좌",
      opening_balance: 12345,
      group_name: "저축",
      hidden: true,
    });
  });

  test("creates, patches, lists hidden assets and deletes an unused asset", async () => {
    const created = await asset({ name: "샘플현금", kind: "cash", group_name: "현금", sort: 9 });
    const patched = await request(`/api/v1/assets/${created.id}`, {
      method: "PATCH",
      body: { name: "테스트현금", hidden: true, opening_balance: 123 },
    });
    expect(patched.status).toBe(200);
    expect(AssetSchema.parse(await patched.json())).toMatchObject({ name: "테스트현금", hidden: true });
    const visible = await (await request("/api/v1/assets")).json();
    expect(visible.items.some((row: { id: string }) => row.id === created.id)).toBe(false);
    const all = await (await request("/api/v1/assets?include_hidden=true")).json();
    expect(all.items.find((row: { id: string }) => row.id === created.id).balance).toBe(123);
    expect((await request(`/api/v1/assets/${created.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await request(`/api/v1/assets/${created.id}`, { method: "PATCH", body: {} })).status).toBe(404);
  });

  test("rejects missing, invalid or self-linked check card accounts and invalid fields", async () => {
    const cash = await asset({ name: "샘플현금", kind: "cash" });
    for (const linked of [undefined, "missing", cash.id]) {
      expect(
        (
          await request("/api/v1/assets", {
            method: "POST",
            body: { name: "샘플체크", kind: "check_card", linked_asset_id: linked },
          })
        ).status,
      ).toBe(400);
    }
    for (const body of [
      { name: "샘플카드", kind: "credit_card", settlement_day: 32 },
      { name: "샘플카드", kind: "credit_card", performance_target: -1 },
      { name: "샘플현금", kind: "cash", payment_day: 1 },
      { name: "샘플현금", kind: "cash", external_ref: "forbidden" },
    ])
      expect((await request("/api/v1/assets", { method: "POST", body })).status).toBe(400);
    expect(
      (
        await request(`/api/v1/assets/${cash.id}`, {
          method: "PATCH",
          body: { kind: "check_card", linked_asset_id: cash.id },
        })
      ).status,
    ).toBe(400);
  });

  test("protects referenced assets including tombstones and linked cards", async () => {
    const { bank, credit } = await card();
    softDelete(app.db, tx(credit.id, 100).id);
    expect((await request(`/api/v1/assets/${credit.id}`, { method: "DELETE" })).status).toBe(409);
    expect((await request(`/api/v1/assets/${bank.id}`, { method: "DELETE" })).status).toBe(409);
    expect((await request(`/api/v1/assets/${bank.id}`, { method: "PATCH", body: { kind: "cash" } })).status).toBe(400);
  });
});

describe("balances and card cycles", () => {
  test("excludes only the pre-cutoff receiving leg and counts KST boundary and future transfers", async () => {
    const bank = await asset({ name: "테스트계좌", kind: "bank", opening_balance: 100000 });
    const target = await asset({
      name: "샘플자산",
      kind: "other",
      opening_balance: 20000,
      opening_date: "2026-03-15",
    });
    for (const [amount, at] of [
      [1000, "2026-03-14T14:59:59Z"],
      [2000, "2026-03-14T15:00:00Z"],
      [3000, "2026-03-16T00:00:00+09:00"],
    ] as const)
      tx(bank.id, amount, at, { type: "transfer", to_asset_id: target.id });
    const result = await summary();
    expect(result.assets.find((row) => row.id === bank.id)?.balance).toBe(94000);
    expect(result.assets.find((row) => row.id === target.id)?.balance).toBe(25000);
    expect(app.db.query("SELECT id FROM transactions").all()).toHaveLength(3);
  });

  test("uses each source cutoff for income expense refunds and outgoing transfers", async () => {
    const source = await asset({
      name: "샘플자산",
      kind: "other",
      opening_balance: 20000,
      opening_date: "2026-03-15",
    });
    const bank = await asset({ name: "테스트계좌", kind: "bank" });
    for (const at of ["2026-03-14T12:00:00+09:00", "2026-03-15T00:00:00+09:00"]) {
      tx(source.id, 5000, at, { type: "income" });
      tx(source.id, 2000, at);
      tx(source.id, 500, at, { is_refund: true });
      tx(source.id, 1000, at, { type: "transfer", to_asset_id: bank.id });
    }
    const result = await summary();
    expect(result.assets.find((row) => row.id === source.id)?.balance).toBe(22500);
    expect(result.assets.find((row) => row.id === bank.id)?.balance).toBe(2000);
  });

  test("resolves check cards to the bank before applying either leg cutoff", async () => {
    const bank = await asset({
      name: "테스트계좌",
      kind: "bank",
      opening_balance: 100000,
      opening_date: "2026-03-15",
    });
    const check = await asset({
      name: "샘플체크",
      kind: "check_card",
      linked_asset_id: bank.id,
      opening_date: "2026-03-20",
      performance_target: 10000,
    });
    const cash = await asset({ name: "샘플현금", kind: "cash", opening_balance: 20000 });
    for (const at of ["2026-03-14T12:00:00+09:00", "2026-03-15T00:00:00+09:00"]) {
      tx(check.id, 3000, at);
      tx(cash.id, 1000, at, { type: "transfer", to_asset_id: check.id });
      tx(check.id, 2000, at, { type: "transfer", to_asset_id: cash.id });
    }
    const result = await summary();
    expect(result.assets.find((row) => row.id === bank.id)?.balance).toBe(96000);
    expect(result.assets.find((row) => row.id === check.id)).toMatchObject({
      balance: 96000,
      usage: 6000,
      performance: { target: 10000, achieved: 6000, pct: 60 },
    });
    expect(result.assets.find((row) => row.id === cash.id)?.balance).toBe(22000);
  });

  test("opening dates do not filter credit card period metrics", async () => {
    const { bank, credit } = await card();
    tx(credit.id, 9000, "2026-03-01T00:00:00+09:00");
    tx(credit.id, 6000, "2026-03-15T00:00:00+09:00");
    tx(bank.id, 1000, "2026-03-15T01:00:00+09:00", { type: "transfer", to_asset_id: credit.id });
    const before = (await summary()).assets.find((row) => row.id === credit.id);
    if (!before) throw new Error("Missing synthetic credit card");
    expect(
      (
        await request(`/api/v1/assets/${credit.id}`, {
          method: "PATCH",
          body: { opening_date: "2026-03-16" },
        })
      ).status,
    ).toBe(200);
    const after = (await summary()).assets.find((row) => row.id === credit.id);
    expect(after).toEqual({ ...before, opening_date: "2026-03-16", balance: 0 });
  });

  test("omitted dates retain all history and patch omission preserves dates while null clears them", async () => {
    const bank = await asset({ name: "테스트계좌", kind: "bank", opening_balance: 10000 });
    expect(bank).toHaveProperty("opening_date", null);
    tx(bank.id, 1000, "2026-03-01T00:00:00+09:00");
    for (const [body, balance, date] of [
      [{ opening_date: "2026-03-15" }, 10000, "2026-03-15"],
      [{ name: "샘플계좌" }, 10000, "2026-03-15"],
      [{ opening_date: null }, 9000, null],
    ] as const) {
      expect((await request(`/api/v1/assets/${bank.id}`, { method: "PATCH", body })).status).toBe(200);
      expect((await summary()).assets.find((row) => row.id === bank.id)).toMatchObject({ balance, opening_date: date });
    }
    for (const opening_date of ["2026-02-30", "2026-3-15", "", "2026-03-15T00:00:00+09:00"]) {
      expect((await request(`/api/v1/assets/${bank.id}`, { method: "PATCH", body: { opening_date } })).status).toBe(
        400,
      );
    }
  });

  test("routes check card flows to savings without double counting assets", async () => {
    const bank = await asset({ name: "테스트저축", kind: "savings", opening_balance: 100000 });
    const check = await asset({
      name: "샘플체크",
      kind: "check_card",
      linked_asset_id: bank.id,
      performance_target: 10000,
    });
    tx(check.id, 12000);
    tx(check.id, 2000, undefined, { is_refund: true });
    tx(check.id, 3000, undefined, { type: "income" });
    const cash = await asset({ name: "샘플현금", kind: "cash" });
    tx(check.id, 4000, undefined, { type: "transfer", to_asset_id: cash.id });
    const hidden = tx(check.id, 99000);
    app.db.query("UPDATE transactions SET hidden=1 WHERE id=?").run(hidden.id);
    softDelete(app.db, tx(check.id, 99000).id);
    const result = await summary();
    expect(result.assets.find((row) => row.id === bank.id)?.balance).toBe(89000);
    expect(result.assets.find((row) => row.id === check.id)).toMatchObject({
      balance: 89000,
      usage: 10000,
      cycle: { from: "2026-03-01", to: "2026-03-31" },
      performance: { target: 10000, achieved: 10000, pct: 100 },
    });
    expect(result.totals).toEqual({ assets: 93000, debts: 0, net_worth: 93000 });
  });

  test("uses inclusive settlement boundaries, refunds and last closed cycle payments", async () => {
    const { credit } = await card();
    tx(credit.id, 90000, "2026-02-15T00:00:00+09:00");
    tx(credit.id, 10000, "2026-03-14T23:59:59+09:00");
    tx(credit.id, 10000, "2026-03-14T12:00:00+09:00", { is_refund: true });
    tx(credit.id, 30000, "2026-03-14T16:00:00Z"); // March 15 in KST.
    tx(credit.id, 30000, "2026-04-14T23:59:59+09:00");
    const row = (await summary()).assets.find((item) => item.id === credit.id);
    expect(row).toMatchObject({
      balance: -150000,
      usage: 60000,
      expected_payment: 90000,
      cycle: { from: "2026-03-15", to: "2026-04-14" },
      payment_date: "2026-05-01",
      performance: { target: 300000, achieved: 60000, pct: 20 },
    });
  });

  test.each([
    ["2026-03-14", 14, 1, "2026-02-15", "2026-03-14", "2026-04-01"],
    ["2026-02-28", 31, 31, "2026-02-01", "2026-02-28", "2026-03-31"],
    ["2024-02-29", 31, 30, "2024-02-01", "2024-02-29", "2024-03-30"],
    ["2026-03-15", 14, 20, "2026-03-15", "2026-04-14", "2026-04-20"],
  ])("clamps cycle dates for %s", async (today, settlement, payment, from, to, due) => {
    setSystemTime(new Date(`${today}T12:00:00+09:00`));
    const { credit } = await card(settlement, payment);
    expect((await summary()).assets.find((row) => row.id === credit.id)).toMatchObject({
      cycle: { from, to },
      payment_date: due,
    });
  });

  test("reports imported balances and signed debt totals without duplicating check cards", async () => {
    const { bank, credit } = await card();
    const loan = await asset({ name: "샘플대출", kind: "loan", opening_balance: -200000 });
    tx(credit.id, 10000);
    app.db.query("UPDATE assets SET external_ref=? WHERE id=?").run("synthetic:account", bank.id);
    app.db
      .query("INSERT INTO import_state(key,value) VALUES(?,?)")
      .run("reported:synthetic:account", JSON.stringify({ balance: 999000, at: "2026-03-15T10:00:00+09:00" }));
    const result = await summary();
    expect(result.assets.find((row) => row.id === bank.id)).toMatchObject({
      reported_balance: 999000,
      reported_at: "2026-03-15T10:00:00+09:00",
      mismatch: 1000,
    });
    expect(result.assets.find((row) => row.id === loan.id)?.balance).toBe(-200000);
    expect(result.totals).toEqual({ assets: 1000000, debts: 210000, net_worth: 790000 });
  });
});

describe("card payment", () => {
  test("defaults to unpaid closed cycle usage and zeroes outstanding through tx-core", async () => {
    const { bank, credit } = await card();
    tx(credit.id, 80000, "2026-03-01T10:00:00+09:00");
    const response = await request(`/api/v1/assets/${credit.id}/card-payment`, { method: "POST", body: {} });
    expect(response.status).toBe(201);
    const payment = TransactionSchema.parse(await response.json());
    expect(payment).toMatchObject({
      type: "transfer",
      source: "card_payment",
      amount: 80000,
      asset_id: bank.id,
      to_asset_id: credit.id,
    });
    const result = await summary();
    expect(result.assets.find((row) => row.id === credit.id)).toMatchObject({
      balance: 0,
      expected_payment: 0,
      usage: 0,
    });
    expect(result.assets.find((row) => row.id === bank.id)?.balance).toBe(920000);
    expect((await request(`/api/v1/assets/${credit.id}/card-payment`, { method: "POST", body: {} })).status).toBe(400);
  });

  test("accepts partial dated payments without subtracting older cycle payments", async () => {
    const { bank, credit } = await card();
    tx(credit.id, 50000, "2026-03-01T10:00:00+09:00");
    insertTransaction(
      app.db,
      TransactionInputSchema.parse({
        type: "transfer",
        asset_id: bank.id,
        to_asset_id: credit.id,
        amount: 10000,
        occurred_at: "2026-02-20T10:00:00+09:00",
      }),
      { source: "card_payment" },
    );
    const response = await request(`/api/v1/assets/${credit.id}/card-payment`, {
      method: "POST",
      body: { amount: 20000, date: "2026-03-15" },
    });
    expect(response.status).toBe(201);
    expect(TransactionSchema.parse(await response.json()).occurred_at).toBe("2026-03-15T00:00:00+09:00");
    expect((await summary()).assets.find((row) => row.id === credit.id)).toMatchObject({
      balance: -20000,
      expected_payment: 30000,
    });
  });

  test("rejects noncredit cards, missing accounts, invalid dates and unsafe amounts atomically", async () => {
    const cash = await asset({ name: "샘플현금", kind: "cash" });
    const credit = await asset({ name: "샘플카드", kind: "credit_card" });
    for (const [id, body] of [
      [cash.id, { amount: 1 }],
      [credit.id, { amount: 1 }],
      [credit.id, { amount: -1 }],
      [credit.id, { amount: 0 }],
      [credit.id, { amount: 1.2 }],
      [credit.id, { amount: 1, date: "2026-02-30" }],
      [credit.id, { amount: 1, source: "manual" }],
    ] as const)
      expect((await request(`/api/v1/assets/${id}/card-payment`, { method: "POST", body })).status).toBe(400);
    expect((await request("/api/v1/assets/missing/card-payment", { method: "POST", body: {} })).status).toBe(404);
    expect(app.db.query<{ count: number }, []>("SELECT count(*) AS count FROM transactions").get()?.count).toBe(0);
  });
});
