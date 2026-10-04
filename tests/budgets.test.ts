import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { openDb } from "../server/db";
import type { AppBindings } from "../server/http";
import { onError } from "../server/http";
import { budgetsRoutes } from "../server/routes/budgets";

let db: Database | undefined;
let api: (path: string, init?: { method?: string; body?: unknown }) => Promise<Response>;

afterEach(() => {
  db?.close();
  db = undefined;
});

function getDb(): Database {
  if (!db) throw new Error("Budget database is not initialized");
  return db;
}

function setupBudgetsApi(): void {
  const database = openDb(":memory:");
  db = database;
  const app = new Hono<AppBindings>();
  app.onError(onError);
  app.use("*", async (c, next) => {
    c.set("db", database);
    await next();
  });
  app.route("/api/v1", budgetsRoutes);
  api = async (path, init = {}) => {
    const headers = new Headers();
    if (init.body !== undefined) headers.set("Content-Type", "application/json");
    return await app.request(path, {
      ...(init.method === undefined ? {} : { method: init.method }),
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  };
}

describe("budgets API", () => {
  test("uses defaults, month overrides, child spending and refunds in the accounting range", async () => {
    setupBudgetsApi();
    const parent = getDb()
      .query<{ id: string }, []>("SELECT id FROM categories WHERE name='식비' AND parent_id IS NULL")
      .get();
    const child = getDb()
      .query<{ id: string }, [string]>("SELECT id FROM categories WHERE name='카페' AND parent_id=?")
      .get(parent?.id ?? "");
    const asset = getDb().query<{ id: string }, []>("SELECT id FROM assets WHERE kind='cash'").get();
    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    expect(asset).toBeDefined();
    getDb().query("UPDATE settings SET value='25' WHERE key='month_start_day'").run();

    const addTransaction = (occurredAt: string, amount: number, isRefund = false) =>
      getDb()
        .query(
          `INSERT INTO transactions
            (id,type,occurred_at,amount,is_refund,asset_id,category_id,merchant,merchant_key,created_at,updated_at)
           VALUES(?, 'expense', ?, ?, ?, ?, ?, '', '', ?, ?)`,
        )
        .run(
          Bun.randomUUIDv7(),
          occurredAt,
          amount,
          Number(isRefund),
          asset?.id ?? null,
          child?.id ?? null,
          occurredAt,
          occurredAt,
        );
    addTransaction("2026-10-24T23:59:00+09:00", 9000);
    addTransaction("2026-10-25T00:00:00+09:00", 12000);
    addTransaction("2026-11-02T12:00:00+09:00", 2000, true);
    addTransaction("2026-11-25T00:00:00+09:00", 7000);

    const saveDefault = await api("/api/v1/budgets", {
      method: "PUT",
      body: { amount: 10000 },
    });
    expect(saveDefault.status).toBe(200);
    const defaultBudget = (await saveDefault.json()) as {
      id: string;
      category_id: string;
      month: string;
      amount: number;
    };
    expect(defaultBudget).toMatchObject({ category_id: "", month: "", amount: 10000 });

    const saveDefaultCategory = await api("/api/v1/budgets", {
      method: "PUT",
      body: { category_id: parent?.id, amount: 12000 },
    });
    expect(saveDefaultCategory.status).toBe(200);
    const saveOverride = await api("/api/v1/budgets", {
      method: "PUT",
      body: { category_id: parent?.id, month: "2026-10", amount: 15000 },
    });
    expect(saveOverride.status).toBe(200);
    const override = (await saveOverride.json()) as { id: string };

    const response = await api("/api/v1/budgets?month=2026-10");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      month: "2026-10",
      range: { from: "2026-10-25", to: "2026-11-24" },
      total: {
        budget_id: defaultBudget.id,
        budget_month: "",
        budget: 10000,
        spent: 10000,
        remaining: 0,
        pct: 100,
        over: false,
      },
      categories: [
        expect.objectContaining({
          category_id: parent?.id,
          name: "식비",
          budget: 15000,
          spent: 10000,
          remaining: 5000,
          pct: 66.67,
          over: false,
        }),
        expect.objectContaining({ category_id: child?.id, budget: null, spent: 10000 }),
      ],
    });

    const deleteResponse = await api(`/api/v1/budgets/${override.id}`, { method: "DELETE" });
    expect(deleteResponse.status).toBe(200);
    const afterDelete = await api("/api/v1/budgets?month=2026-10");
    const deletedBody = (await afterDelete.json()) as { categories: Array<{ category_id: string }> };
    expect(deletedBody.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category_id: parent?.id, budget: 12000, spent: 10000 }),
        expect.objectContaining({ category_id: child?.id, budget: null, spent: 10000 }),
      ]),
    );
  });

  test("lists over-budget and unbudgeted spending; rejects invalid input", async () => {
    setupBudgetsApi();
    const category = getDb()
      .query<{ id: string }, []>("SELECT id FROM categories WHERE name='식비' AND parent_id IS NULL")
      .get();
    const child = getDb()
      .query<{ id: string }, [string]>("SELECT id FROM categories WHERE name='카페' AND parent_id=?")
      .get(category?.id ?? "");
    const asset = getDb().query<{ id: string }, []>("SELECT id FROM assets WHERE kind='cash'").get();
    const now = "2026-10-12T12:00:00+09:00";
    getDb()
      .query(
        `INSERT INTO transactions
          (id,type,occurred_at,amount,is_refund,asset_id,category_id,merchant,merchant_key,created_at,updated_at)
         VALUES(?, 'expense', ?, 5000, 0, ?, ?, '', '', ?, ?)`,
      )
      .run(Bun.randomUUIDv7(), now, asset?.id ?? null, child?.id ?? null, now, now);
    const saved = await api("/api/v1/budgets", {
      method: "PUT",
      body: { category_id: category?.id, month: "2026-10", amount: 3000 },
    });
    expect(saved.status).toBe(200);

    const response = await api("/api/v1/budgets?month=2026-10");
    const body = (await response.json()) as {
      categories: Array<{ category_id: string; budget: number | null; spent: number; over: boolean }>;
    };
    expect(body.categories).toEqual([
      expect.objectContaining({ category_id: category?.id, budget: 3000, spent: 5000, over: true }),
      expect.objectContaining({ category_id: child?.id, budget: null, spent: 5000, over: false }),
    ]);

    const negative = await api("/api/v1/budgets", {
      method: "PUT",
      body: { amount: -1 },
    });
    expect(negative.status).toBe(400);
    expect(await negative.json()).toMatchObject({ error: { code: "invalid_input" } });
    const invalidMonth = await api("/api/v1/budgets?month=2026-13");
    expect(invalidMonth.status).toBe(400);
  });

  test("exposes the selected budget ID and scope so a reloaded client can delete it", async () => {
    setupBudgetsApi();
    const defaultResponse = await api("/api/v1/budgets", { method: "PUT", body: { amount: 10000 } });
    const defaultBudget = await defaultResponse.json();
    const overrideResponse = await api("/api/v1/budgets", {
      method: "PUT",
      body: { month: "2026-10", amount: 15000 },
    });
    const override = await overrideResponse.json();
    const category = getDb()
      .query<{ id: string }, []>("SELECT id FROM categories WHERE name='식비' AND parent_id IS NULL")
      .get();
    if (!category) throw new Error("Seeded food category missing");
    const categoryResponse = await api("/api/v1/budgets", {
      method: "PUT",
      body: { category_id: category.id, amount: 5000 },
    });
    const categoryBudget = await categoryResponse.json();
    const current = await (await api("/api/v1/budgets?month=2026-10")).json();
    expect(current.total).toMatchObject({ budget_id: override.id, budget_month: "2026-10", budget: 15000 });
    expect(current.categories).toContainEqual(
      expect.objectContaining({
        category_id: category.id,
        budget_id: categoryBudget.id,
        budget_month: "",
      }),
    );
    expect((await api(`/api/v1/budgets/${current.total.budget_id}`, { method: "DELETE" })).status).toBe(200);
    const inherited = await (await api("/api/v1/budgets?month=2026-10")).json();
    expect(inherited.total).toMatchObject({ budget_id: defaultBudget.id, budget_month: "", budget: 10000 });
    expect((await api(`/api/v1/budgets/${inherited.total.budget_id}`, { method: "DELETE" })).status).toBe(200);
    const removed = await (await api("/api/v1/budgets?month=2026-10")).json();
    expect(removed.total).toMatchObject({ budget_id: null, budget_month: null, budget: null });
  });
});
