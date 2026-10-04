import { afterEach, expect, test } from "bun:test";
import { authed, makeTestApp, type TestApp } from "./helpers";

const apps: TestApp[] = [];
const setup = async () => {
  const app = makeTestApp();
  apps.push(app);
  return { app, request: await authed(app) };
};
afterEach(() => {
  for (const app of apps.splice(0)) app.cleanup();
});

test("UTC input is stored and filtered on its Korean calendar date", async () => {
  const { request } = await setup();
  const created = await request("/api/v1/transactions", {
    method: "POST",
    body: { type: "expense", amount: 1000, occurred_at: "2026-09-30T15:30:00Z", merchant: "테스트마트" },
  });
  expect(created.status).toBe(201);
  const transaction = await created.json();
  expect(transaction.occurred_at).toBe("2026-10-01T00:30:00+09:00");
  const firstDay = await (await request("/api/v1/transactions?from=2026-10-01&to=2026-10-01")).json();
  expect(firstDay.items).toHaveLength(1);
  expect(
    (
      await request(`/api/v1/transactions/${transaction.id}`, {
        method: "PATCH",
        body: { occurred_at: "2026-10-01T16:00:00Z" },
      })
    ).status,
  ).toBe(200);
  const moved = await (await request("/api/v1/transactions?from=2026-10-02&to=2026-10-02")).json();
  expect(moved.items).toHaveLength(1);
  expect(moved.items[0].occurred_at).toBe("2026-10-02T01:00:00+09:00");
});

test("type and category can be changed together using the new type", async () => {
  const { app, request } = await setup();
  const expense = app.db.query<{ id: string }, []>("SELECT id FROM categories WHERE type='expense' LIMIT 1").get();
  const income = app.db.query<{ id: string }, []>("SELECT id FROM categories WHERE type='income' LIMIT 1").get();
  if (!expense || !income) throw new Error("Seeded categories missing");
  const transaction = await (
    await request("/api/v1/transactions", {
      method: "POST",
      body: { type: "expense", category_id: expense.id, amount: 1000, occurred_at: "2026-10-01T12:00:00+09:00" },
    })
  ).json();
  const response = await request(`/api/v1/transactions/${transaction.id}`, {
    method: "PATCH",
    body: { type: "income", category_id: income.id },
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ type: "income", category_id: income.id });
});

test("an incompatible retained category rejects a type change without altering the row", async () => {
  const { app, request } = await setup();
  const expense = app.db.query<{ id: string }, []>("SELECT id FROM categories WHERE type='expense' LIMIT 1").get();
  if (!expense) throw new Error("Seeded category missing");
  const transaction = await (
    await request("/api/v1/transactions", {
      method: "POST",
      body: { type: "expense", category_id: expense.id, amount: 1000, occurred_at: "2026-10-01T12:00:00+09:00" },
    })
  ).json();
  expect(
    (
      await request(`/api/v1/transactions/${transaction.id}`, {
        method: "PATCH",
        body: { type: "income" },
      })
    ).status,
  ).toBe(400);
  expect(
    app.db.query<{ type: string }, [string]>("SELECT type FROM transactions WHERE id=?").get(transaction.id)?.type,
  ).toBe("expense");
});

test("an unknown asset in a patch is a client error and leaves the transaction intact", async () => {
  const { app, request } = await setup();
  const transaction = await (
    await request("/api/v1/transactions", {
      method: "POST",
      body: { type: "expense", amount: 1000, occurred_at: "2026-10-01T12:00:00+09:00" },
    })
  ).json();
  expect(
    (
      await request(`/api/v1/transactions/${transaction.id}`, {
        method: "PATCH",
        body: { asset_id: Bun.randomUUIDv7(), amount: 2000 },
      })
    ).status,
  ).toBe(400);
  expect(
    app.db.query<{ amount: number }, [string]>("SELECT amount FROM transactions WHERE id=?").get(transaction.id)
      ?.amount,
  ).toBe(1000);
});
