import { afterEach, expect, test } from "bun:test";
import { insertTransaction } from "../server/domain/tx-core";
import { TransactionInputSchema } from "../shared/schema";
import { authed, makeTestApp, type TestApp } from "./helpers";

const apps: TestApp[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.cleanup();
});

test("single-transaction reads find older, hidden and deleted records without pagination", async () => {
  const app = makeTestApp();
  apps.push(app);
  const request = await authed(app);
  const created = await request("/api/v1/transactions", {
    method: "POST",
    body: { type: "expense", amount: 1000, occurred_at: "2025-01-01T12:00:00+09:00", merchant: "테스트과거거래" },
  });
  const old = await created.json();
  const insert = app.db.query(
    "INSERT INTO transactions(id,type,occurred_at,amount,created_at,updated_at) VALUES(?,'expense',?,100,?,?)",
  );
  app.db.transaction(() => {
    const at = "2026-10-01T12:00:00+09:00";
    for (let i = 0; i < 1001; i++) insert.run(Bun.randomUUIDv7(), at, at, at);
  })();
  const firstPage = await (await request("/api/v1/transactions?limit=1000")).json();
  expect(firstPage.items.some((row: { id: string }) => row.id === old.id)).toBe(false);
  const read = await request(`/api/v1/transactions/${old.id}`);
  expect(read.status).toBe(200);
  expect((await read.json()).merchant).toBe("테스트과거거래");
  await request(`/api/v1/transactions/${old.id}`, { method: "PATCH", body: { hidden: true } });
  await request(`/api/v1/transactions/${old.id}`, { method: "DELETE" });
  const archived = await request(`/api/v1/transactions/${old.id}`);
  expect(archived.status).toBe(200);
  expect(await archived.json()).toMatchObject({ id: old.id, hidden: true, deleted_at: expect.any(String) });
  expect((await app.request(`/api/v1/transactions/${old.id}`)).status).toBe(401);
  expect((await request(`/api/v1/transactions/${Bun.randomUUIDv7()}`)).status).toBe(404);
});

test("automatic records keep their original imported text after the owner renames them", async () => {
  const app = makeTestApp();
  apps.push(app);
  const request = await authed(app);
  const entry = {
    id: 77,
    at: "2026-10-04T15:20:00+09:00",
    account: "3333-00-0000000",
    kind: "체크카드결제",
    amount: -8751,
    counterparty: "SAMPLE*TESTSHOP 851",
    balance: 431249,
  };
  const sms = insertTransaction(
    app.db,
    TransactionInputSchema.parse({
      type: "expense",
      occurred_at: entry.at,
      amount: 8751,
      merchant: entry.counterparty,
    }),
    {
      source: "kakaobank_sms",
      source_key: "kb-sms:77",
      source_raw: JSON.stringify(entry),
      src_account: entry.account,
      src_amount: entry.amount,
      src_at: entry.at,
    },
  );
  const manual = await request("/api/v1/transactions", {
    method: "POST",
    body: { type: "expense", amount: 1000, occurred_at: entry.at, merchant: "테스트마트" },
  });
  expect((await manual.json()).source_detail).toBeNull();
  const renamed = await request(`/api/v1/transactions/${sms.id}`, {
    method: "PATCH",
    body: { merchant: "샘플 구독료" },
  });
  expect(renamed.status).toBe(200);
  const original = {
    kind: "체크카드결제",
    counterparty: "SAMPLE*TESTSHOP 851",
    account: "3333-00-0000000",
    amount: -8751,
    balance: 431249,
    currency: null,
    at: "2026-10-04T15:20:00+09:00",
  };
  expect(await (await request(`/api/v1/transactions/${sms.id}`)).json()).toMatchObject({
    merchant: "샘플 구독료",
    source_detail: original,
  });
  const list = await (await request("/api/v1/transactions?from=2026-10-04&to=2026-10-04")).json();
  expect(list.items.find((item: { id: string }) => item.id === sms.id)?.source_detail).toEqual(original);
});
