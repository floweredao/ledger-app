import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { openDb } from "../../../server/db";
import { type AppBindings, onError } from "../../../server/http";
import { assetsRoutes } from "../../../server/routes/assets";
import { type AssetInput, AssetSchema, AssetSummarySchema } from "../../../shared/schema";

let db: Database;
let app: Hono<AppBindings>;
beforeEach(() => {
  db = openDb(":memory:");
  app = new Hono<AppBindings>();
  app.onError(onError);
  app.use("*", async (c, next) => {
    c.set("db", db);
    await next();
  });
  app.route("/api/v1", assetsRoutes);
});
afterEach(() => db.close());
function request(path: string, method = "GET", body?: unknown) {
  return app.request(`/api/v1/${path}`, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
}
async function create(input: Partial<AssetInput> & Pick<AssetInput, "name" | "kind">) {
  const response = await request("assets", "POST", input);
  expect(response.status).toBe(201);
  return AssetSchema.parse(await response.json());
}
async function summary() {
  const response = await request("assets/summary");
  expect(response.status).toBe(200);
  return AssetSummarySchema.parse(await response.json());
}

test("summary includes kind balance and exact totals", async () => {
  const bank = await create({ name: "테스트은행", kind: "bank", opening_balance: 100000 });
  const result = await summary();
  expect(result.assets.find((item) => item.id === bank.id)?.balance).toBe(100000);
  expect(result.totals).toEqual({ assets: 100000, debts: 0, net_worth: 100000 });
});
test("bank summary exposes nullable sync fields without inventing reports", async () => {
  const bank = await create({ name: "테스트은행", kind: "bank", opening_balance: 100000 });
  const result = (await summary()).assets.find((item) => item.id === bank.id);
  expect(result?.reported_balance).toBeNull();
  expect(result?.reported_at).toBeNull();
  expect(result?.mismatch).toBeNull();
});
test("credit card summary supplies cycle and performance independently of debt", async () => {
  const card = await create({
    name: "샘플카드",
    kind: "credit_card",
    opening_balance: 50000,
    settlement_day: 10,
    payment_day: 25,
    performance_target: 100000,
  });
  const result = (await summary()).assets.find((item) => item.id === card.id);
  expect(result?.cycle?.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(result?.cycle?.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(result?.balance).toBe(-50000);
  expect(result?.usage).toBe(0);
  expect(result?.performance).toEqual({ target: 100000, achieved: 0, pct: 0 });
});
test("payment transfers bank to card and changes both balances", async () => {
  const bank = await create({ name: "테스트은행", kind: "bank", opening_balance: 100000 });
  const card = await create({
    name: "샘플카드",
    kind: "credit_card",
    linked_asset_id: bank.id,
    opening_balance: 50000,
  });
  const response = await request(`assets/${card.id}/card-payment`, "POST", { amount: 38000, date: "2026-10-03" });
  expect(response.status).toBe(201);
  const transaction = await response.json();
  expect(transaction).toMatchObject({
    type: "transfer",
    asset_id: bank.id,
    to_asset_id: card.id,
    amount: 38000,
    source: "card_payment",
  });
  const result = await summary();
  expect(result.assets.find((item) => item.id === bank.id)?.balance).toBe(62000);
  expect(result.assets.find((item) => item.id === card.id)?.balance).toBe(-12000);
});
test("missing check card link rejects creation and patch on a real existing card", async () => {
  const invalid = await request("assets", "POST", { name: "샘플체크", kind: "check_card", linked_asset_id: null });
  expect(invalid.status).toBe(400);
  expect((await invalid.json()).error.code).toBe("invalid_asset");
  const bank = await create({ name: "테스트은행", kind: "bank" });
  const card = await create({ name: "샘플체크", kind: "check_card", linked_asset_id: bank.id });
  const response = await request(`assets/${card.id}`, "PATCH", { linked_asset_id: null });
  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe("invalid_asset");
  expect((await summary()).assets.find((item) => item.id === card.id)?.linked_asset_id).toBe(bank.id);
});
test("deletion preserves referenced bank and offers hide via API", async () => {
  const bank = await create({ name: "테스트은행", kind: "bank" });
  await create({ name: "샘플카드", kind: "credit_card", linked_asset_id: bank.id });
  const response = await request(`assets/${bank.id}`, "DELETE");
  expect(response.status).toBe(409);
  expect((await response.json()).error.code).toBe("in_use");
});
test("hide patch leaves omitted balance and group unchanged", async () => {
  const bank = await create({ name: "테스트은행", kind: "bank", opening_balance: 100000, group_name: "샘플그룹" });
  const response = await request(`assets/${bank.id}`, "PATCH", { hidden: true });
  expect(response.status).toBe(200);
  expect(AssetSchema.parse(await response.json())).toMatchObject({
    hidden: true,
    opening_balance: 100000,
    group_name: "샘플그룹",
  });
});
test("list items excludes hidden and include_hidden restores them", async () => {
  const hidden = await create({ name: "숨김은행", kind: "bank", hidden: true });
  const visible = await create({ name: "보임은행", kind: "bank" });
  const list = await (await request("assets?include_hidden=false")).json();
  expect(list.items.map((item: { id: string }) => item.id)).toContain(visible.id);
  expect(list.items.map((item: { id: string }) => item.id)).not.toContain(hidden.id);
  const all = await (await request("assets?include_hidden=true")).json();
  expect(all.items.map((item: { id: string }) => item.id)).toContain(hidden.id);
});
