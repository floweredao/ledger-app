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

  test("deletes categories and can reassign their references", async () => {
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

type Api = Awaited<ReturnType<typeof setup>>["api"];

describe("moving categories and reassigning before delete", () => {
  const stamp = "2026-10-03T10:00:00+09:00";
  async function tree(api: Api) {
    return (await json(await api("/api/v1/categories?type=expense&include_hidden=true"))).items;
  }
  async function make(api: Api, name: string, parentId?: string) {
    const body = {
      type: "expense",
      name,
      ...(parentId ? { parent_id: parentId } : {}),
      color: parentId ? null : "cat-4",
    };
    return json(await api("/api/v1/categories", { method: "POST", body }));
  }

  test("moves a child under another parent, appended to its children", async () => {
    const { api } = await setup();
    const a = await make(api, "테스트상위A");
    const b = await make(api, "테스트상위B");
    const kid = await make(api, "테스트하위", a.id);
    await make(api, "기존하위", b.id);
    const moved = await api(`/api/v1/categories/${kid.id}`, { method: "PATCH", body: { parent_id: b.id } });
    expect(moved.status).toBe(200);
    const items = await tree(api);
    expect(items.find((c) => c.id === a.id)?.children).toEqual([]);
    expect(items.find((c) => c.id === b.id)?.children.map((c) => c.name)).toEqual(["기존하위", "테스트하위"]);
  });

  test("moving a top-level category with children under another brings the children along", async () => {
    const { api } = await setup();
    const a = await make(api, "옮길상위");
    const b = await make(api, "받을상위");
    const k1 = await make(api, "하위1", a.id);
    const k2 = await make(api, "하위2", a.id);
    const moved = await api(`/api/v1/categories/${a.id}`, { method: "PATCH", body: { parent_id: b.id } });
    expect(moved.status).toBe(200);
    const items = await tree(api);
    expect(items.some((c) => c.id === a.id)).toBe(false);
    expect(items.find((c) => c.id === b.id)?.children.map((c) => c.id)).toEqual([a.id, k1.id, k2.id]);
  });

  test("promoting a child to top level keeps the color it showed", async () => {
    const { api } = await setup();
    const a = await make(api, "색상상위");
    const kid = await make(api, "색상하위", a.id);
    const promoted = (await (
      await api(`/api/v1/categories/${kid.id}`, { method: "PATCH", body: { parent_id: null } })
    ).json()) as Category;
    expect(promoted.parent_id).toBeNull();
    expect(promoted.color).toBe("cat-4");
  });

  test("rejects moves that would break the tree and leaves it unchanged", async () => {
    const { api } = await setup();
    const a = await make(api, "검사상위");
    const kid = await make(api, "검사하위", a.id);
    const b = await make(api, "검사대상");
    await make(api, "검사하위", b.id);
    const income = (await json(await api("/api/v1/categories?type=income"))).items[0];
    if (!income) throw new Error("Seed income category missing");
    const before = await tree(api);
    const underChild = await api(`/api/v1/categories/${b.id}`, { method: "PATCH", body: { parent_id: kid.id } });
    expect(underChild.status).toBe(400);
    expect((await json(underChild)).error?.code).toBe("max_depth");
    const underOwnChild = await api(`/api/v1/categories/${a.id}`, { method: "PATCH", body: { parent_id: kid.id } });
    expect(underOwnChild.status).toBe(400);
    const otherType = await api(`/api/v1/categories/${a.id}`, { method: "PATCH", body: { parent_id: income.id } });
    expect((await json(otherType)).error?.code).toBe("invalid_parent");
    const nameClash = await api(`/api/v1/categories/${a.id}`, { method: "PATCH", body: { parent_id: b.id } });
    expect(nameClash.status).toBe(409);
    expect(await tree(api)).toEqual(before);
  });

  test("reports what uses a category and how much the reassignment moved", async () => {
    const { testApp, api } = await setup();
    const a = await make(api, "사용중상위");
    const kid = await make(api, "사용중하위", a.id);
    const target = await make(api, "새상위");
    const asset = testApp.db.query<{ id: string }, []>("SELECT id FROM assets LIMIT 1").get();
    if (!asset) throw new Error("Seed asset missing");
    const insertTx = testApp.db.query(
      "INSERT INTO transactions(id,type,occurred_at,amount,asset_id,category_id,deleted_at,created_at,updated_at) VALUES(?, 'expense', ?, 1000, ?, ?, ?, ?, ?)",
    );
    insertTx.run(Bun.randomUUIDv7(), stamp, asset.id, a.id, null, stamp, stamp);
    insertTx.run(Bun.randomUUIDv7(), stamp, asset.id, a.id, null, stamp, stamp);
    insertTx.run(Bun.randomUUIDv7(), stamp, asset.id, a.id, stamp, stamp, stamp);
    testApp.db
      .query("INSERT INTO budgets(id,category_id,month,amount) VALUES(?,?,'',5000)")
      .run(Bun.randomUUIDv7(), a.id);
    testApp.db
      .query("INSERT INTO merchant_rules(merchant_key,category_id,type,updated_at) VALUES('테스트마트',?,'expense',?)")
      .run(a.id, stamp);
    testApp.db
      .query("INSERT INTO templates(id,name,payload,sort,use_count,created_at,updated_at) VALUES(?,?,?,0,0,?,?)")
      .run(Bun.randomUUIDv7(), "샘플", JSON.stringify({ type: "expense", category_id: a.id }), stamp, stamp);

    const usage = await api(`/api/v1/categories/${a.id}/usage`);
    expect(usage.status).toBe(200);
    expect(await usage.json()).toEqual({
      transactions: 2,
      deleted_transactions: 1,
      total_transactions: 2,
      budgets: 1,
      merchant_rules: 1,
      recurring_rules: 0,
      templates: 1,
      children: 1,
    });
    const removed = await api(`/api/v1/categories/${a.id}?reassign_to=${target.id}`, { method: "DELETE" });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({
      ok: true,
      moved: { transactions: 3, budgets: 1, merchant_rules: 1, recurring_rules: 0, templates: 1, children: 1 },
    });
    expect((await tree(api)).find((c) => c.id === target.id)?.children.map((c) => c.id)).toEqual([kid.id]);
    expect((await api(`/api/v1/categories/${a.id}/usage`)).status).toBe(404);
  });

  test("deleting without a target leaves its records uncategorized and removes its children", async () => {
    const { testApp, api } = await setup();
    const a = await make(api, "지울상위");
    const kid = await make(api, "지울하위", a.id);
    const keep = await make(api, "남길분류");
    const asset = testApp.db.query<{ id: string }, []>("SELECT id FROM assets LIMIT 1").get();
    if (!asset) throw new Error("Seed asset missing");
    const insertTx = testApp.db.query(
      "INSERT INTO transactions(id,type,occurred_at,amount,asset_id,category_id,deleted_at,created_at,updated_at) VALUES(?, 'expense', ?, 1000, ?, ?, ?, ?, ?)",
    );
    const live = Bun.randomUUIDv7();
    const childTx = Bun.randomUUIDv7();
    const trashed = Bun.randomUUIDv7();
    const kept = Bun.randomUUIDv7();
    insertTx.run(live, stamp, asset.id, a.id, null, stamp, stamp);
    insertTx.run(childTx, stamp, asset.id, kid.id, null, stamp, stamp);
    insertTx.run(trashed, stamp, asset.id, kid.id, stamp, stamp, stamp);
    insertTx.run(kept, stamp, asset.id, keep.id, null, stamp, stamp);
    const budget = testApp.db.query("INSERT INTO budgets(id,category_id,month,amount) VALUES(?,?,?,5000)");
    budget.run(Bun.randomUUIDv7(), a.id, "");
    budget.run(Bun.randomUUIDv7(), kid.id, "2026-10");
    budget.run(Bun.randomUUIDv7(), keep.id, "");
    testApp.db
      .query("INSERT INTO merchant_rules(merchant_key,category_id,type,updated_at) VALUES(?,?,'expense',?)")
      .run("테스트마트", kid.id, stamp);
    testApp.db
      .query("INSERT INTO templates(id,name,payload,sort,use_count,created_at,updated_at) VALUES(?,?,?,0,0,?,?)")
      .run("tpl", "샘플카페", JSON.stringify({ type: "expense", amount: 3000, category_id: a.id }), stamp, stamp);
    testApp.db
      .query(
        "INSERT INTO recurring_rules(id,template,freq,start_date,created_at,updated_at) VALUES(?,?,'monthly','2026-10-01',?,?)",
      )
      .run("rule", JSON.stringify({ type: "expense", amount: 9000, category_id: kid.id }), stamp, stamp);

    const usage = (await (await api(`/api/v1/categories/${a.id}/usage`)).json()) as { total_transactions: number };
    expect(usage.total_transactions).toBe(2);
    const removed = await api(`/api/v1/categories/${a.id}`, { method: "DELETE" });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({
      ok: true,
      cleared: { transactions: 3, budgets: 2, merchant_rules: 1, recurring_rules: 1, templates: 1, children: 1 },
    });

    const ids = (await tree(api)).flatMap((c) => [c.id, ...c.children.map((child) => child.id)]);
    expect(ids).not.toContain(a.id);
    expect(ids).not.toContain(kid.id);
    expect(ids).toContain(keep.id);
    const categoryOf = (id: string) =>
      testApp.db
        .query<{ category_id: string | null }, [string]>("SELECT category_id FROM transactions WHERE id=?")
        .get(id)?.category_id;
    expect([live, childTx, trashed].map(categoryOf)).toEqual([null, null, null]);
    expect(categoryOf(kept)).toBe(keep.id);
    expect(testApp.db.query("SELECT category_id FROM budgets").all()).toEqual([{ category_id: keep.id }]);
    expect(testApp.db.query("SELECT 1 FROM merchant_rules").all()).toEqual([]);
    const payload = (sql: string) =>
      JSON.parse(testApp.db.query<{ v: string }, []>(sql).get()?.v ?? "{}") as Record<string, unknown>;
    expect(payload("SELECT payload AS v FROM templates")).toEqual({ type: "expense", amount: 3000, category_id: null });
    expect(payload("SELECT template AS v FROM recurring_rules")).toEqual({
      type: "expense",
      amount: 9000,
      category_id: null,
    });
  });
});
