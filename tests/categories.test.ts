import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { openDb } from "../server/db";
import { type AppBindings, onError } from "../server/http";
import { categoriesRoutes } from "../server/routes/categories";
import type { Category } from "../shared/schema";

const tests: Array<{ cleanup: () => void }> = [];

type ApiInit = Omit<RequestInit, "body"> & { body?: unknown };

afterEach(() => {
  for (const testApp of tests.splice(0)) testApp.cleanup();
});

async function setup() {
  const db = openDb(":memory:");
  const app = new Hono<AppBindings>();
  app.onError(onError);
  app.use("*", async (c, next) => {
    c.set("db", db);
    await next();
  });
  app.route("/api/v1", categoriesRoutes);
  const testApp = {
    db,
    request: (path: string, init?: ApiInit) => {
      const headers = new Headers(init?.headers);
      const { body, ...options } = init ?? {};
      if (body !== undefined) headers.set("Content-Type", "application/json");
      return app.request(path, {
        ...options,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    },
    cleanup: () => db.close(),
  };
  tests.push(testApp);
  return { testApp, api: testApp.request };
}

async function json(response: Response) {
  return (await response.json()) as {
    items: Array<Category & { children: Category[] }>;
    error?: { code: string };
    id: string;
    name: string;
    sort: number;
  };
}

describe("categories and merchant rules API", () => {
  test("lists categories as a typed tree including hidden only when requested", async () => {
    const { api } = await setup();
    const response = await api("/api/v1/categories?type=expense");
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.items.find((item) => item.name === "식비")?.children.map((item) => item.name)).toEqual([
      "식사",
      "카페",
      "편의점",
      "배달",
    ]);

    const created = await json(
      await api("/api/v1/categories", {
        method: "POST",
        body: { type: "expense", name: "임시분류" },
      }),
    );
    await api(`/api/v1/categories/${created.id}`, { method: "PATCH", body: { hidden: true } });
    const visible = await json(await api("/api/v1/categories?type=expense"));
    const all = await json(await api("/api/v1/categories?type=expense&include_hidden=true"));
    expect(visible.items.some((item) => item.id === created.id)).toBe(false);
    expect(all.items.some((item) => item.id === created.id && item.hidden)).toBe(true);
  });

  test("rejects mismatched parents and categories deeper than two levels", async () => {
    const { api } = await setup();
    const income = await json(await api("/api/v1/categories?type=income"));
    const incomeParent = income.items[0];
    if (!incomeParent) throw new Error("Seed income category missing");
    const mismatch = await api("/api/v1/categories", {
      method: "POST",
      body: { type: "expense", parent_id: incomeParent.id, name: "잘못된 부모" },
    });
    expect(mismatch.status).toBe(400);
    const expense = await json(await api("/api/v1/categories?type=expense"));
    const parent = expense.items[0];
    if (!parent) throw new Error("Seed expense category missing");
    const child = parent.children[0];
    if (!child) throw new Error("Seed child category missing");
    const tooDeep = await api("/api/v1/categories", {
      method: "POST",
      body: { type: "expense", parent_id: child.id, name: "세 번째 단계" },
    });
    expect(tooDeep.status).toBe(400);
  });

  test("deletes unused categories and requires reassignment for references", async () => {
    const { testApp, api } = await setup();
    const expense = await json(await api("/api/v1/categories?type=expense"));
    const parent = expense.items.find((item) => item.name === "식비");
    if (!parent?.children[0] || !parent.children[1]) throw new Error("Seed category children missing");
    const childId = parent.children[0].id;
    const targetId = parent.children[1].id;
    const asset = testApp.db.query<{ id: string }, []>("SELECT id FROM assets LIMIT 1").get();
    if (!asset) throw new Error("Seed asset missing");
    const assetId = asset.id;
    testApp.db
      .query(
        `INSERT INTO transactions(id,type,occurred_at,amount,asset_id,category_id,created_at,updated_at)
         VALUES(?, 'expense', '2026-10-03T10:00:00+09:00', 1200, ?, ?, '2026-10-03T10:00:00+09:00', '2026-10-03T10:00:00+09:00')`,
      )
      .run(Bun.randomUUIDv7(), assetId, childId);
    testApp.db
      .query("INSERT INTO budgets(id,category_id,month,amount) VALUES(?,?,'',5000)")
      .run(Bun.randomUUIDv7(), childId);
    testApp.db
      .query("INSERT INTO merchant_rules(merchant_key,category_id,type,updated_at) VALUES('samplecafe',?,'expense',?)")
      .run(childId, "2026-10-03T10:00:00+09:00");

    const blocked = await api(`/api/v1/categories/${childId}`, { method: "DELETE" });
    expect(blocked.status).toBe(409);
    expect((await json(blocked)).error?.code).toBe("in_use");

    const reassigned = await api(`/api/v1/categories/${childId}?reassign_to=${targetId}`, { method: "DELETE" });
    expect(reassigned.status).toBe(200);
    expect(testApp.db.query("SELECT 1 FROM categories WHERE id=?").get(childId)).toBeNull();
    expect(testApp.db.query("SELECT 1 FROM transactions WHERE category_id=?").get(targetId)).not.toBeNull();
    expect(testApp.db.query("SELECT 1 FROM merchant_rules WHERE category_id=?").get(targetId)).not.toBeNull();
    expect(
      testApp.db
        .query<{ amount: number }, [string, string]>("SELECT amount FROM budgets WHERE category_id=? AND month=?")
        .get(targetId, "")?.amount,
    ).toBe(5000);
  });

  test("reassigns a deleted category's children to the replacement", async () => {
    const { api } = await setup();
    const original = await json(
      await api("/api/v1/categories", {
        method: "POST",
        body: { type: "expense", name: "이동원본" },
      }),
    );
    const child = await json(
      await api("/api/v1/categories", {
        method: "POST",
        body: { type: "expense", parent_id: original.id, name: "보존하위" },
      }),
    );
    const replacement = await json(
      await api("/api/v1/categories", {
        method: "POST",
        body: { type: "expense", name: "이동대상" },
      }),
    );

    const deleted = await api(`/api/v1/categories/${original.id}?reassign_to=${replacement.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const categories = await json(await api("/api/v1/categories?type=expense"));
    const destination = categories.items.find((item) => item.id === replacement.id);
    expect(destination?.children.map((item) => item.id)).toContain(child.id);
    expect(categories.items.some((item) => item.id === original.id)).toBe(false);
  });

  test("patches and reorders categories within their sibling set", async () => {
    const { api } = await setup();
    const expense = await json(await api("/api/v1/categories?type=expense"));
    const siblings = expense.items.filter((item) => item.parent_id === null).slice(0, 2);
    const firstSibling = siblings[0];
    if (!firstSibling || !siblings[1]) throw new Error("Seed sibling categories missing");
    const reorder = await api("/api/v1/categories/reorder", {
      method: "POST",
      body: { ids: siblings.map((item) => item.id).reverse() },
    });
    expect(reorder.status).toBe(200);
    const reordered = await json(await api("/api/v1/categories?type=expense"));
    expect(reordered.items.slice(0, 2).map((item) => item.id)).toEqual(siblings.map((item) => item.id).reverse());
    const updated = await json(
      await api(`/api/v1/categories/${firstSibling.id}`, {
        method: "PATCH",
        body: { name: "식비수정", icon: "utensils", color: "cat-1", sort: 9 },
      }),
    );
    expect(updated.name).toBe("식비수정");
    expect(updated.sort).toBe(9);
  });

  test("joins merchant rules and deletes a rule", async () => {
    const { testApp, api } = await setup();
    const expense = await json(await api("/api/v1/categories?type=expense"));
    const category = expense.items[0];
    if (!category) throw new Error("Seed expense category missing");
    const categoryId = category.id;
    testApp.db
      .query("INSERT INTO merchant_rules(merchant_key,category_id,type,updated_at) VALUES(?,?,?,?)")
      .run("samplecafe", categoryId, "expense", "2026-10-03T10:00:00+09:00");
    const listed = await json(await api("/api/v1/merchant-rules"));
    expect(listed.items).toContainEqual(
      expect.objectContaining({ merchant_key: "samplecafe", category_id: categoryId, category_name: category.name }),
    );
    const deleted = await api("/api/v1/merchant-rules/samplecafe?type=expense", { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(testApp.db.query("SELECT 1 FROM merchant_rules WHERE merchant_key='samplecafe'").get()).toBeNull();
  });
});
