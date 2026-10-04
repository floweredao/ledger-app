import { afterEach, describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { authed, makeTestApp, type TestApp } from "./helpers";

const apps: TestApp[] = [];
const setup = () => {
  const app = makeTestApp();
  apps.push(app);
  return app;
};
afterEach(() => {
  for (const app of apps.splice(0)) app.cleanup();
});

const payload = (overrides: Record<string, unknown> = {}) => ({
  type: "expense",
  amount: 4500,
  occurred_at: "2026-10-04T09:00:00+09:00",
  merchant: "샘플카페",
  ...overrides,
});
const create = async (fetch: Awaited<ReturnType<typeof authed>>, body = payload()) => {
  const response = await fetch("/api/v1/transactions", { method: "POST", body });
  return { response, body: await response.json() };
};

describe("transactions API", () => {
  test("uncategorized sentinel filters list totals and both exports with the same predicates", async () => {
    const app = setup();
    const fetch = await authed(app);
    const category = app.db.query<{ id: string }, []>("SELECT id FROM categories WHERE type='expense' LIMIT 1").get();
    assert(category);
    const { body: unassigned } = await create(fetch, payload({ category_id: null, merchant: "테스트미분류" }));
    await create(fetch, payload({ category_id: category.id, merchant: "테스트분류됨" }));
    await create(fetch, payload({ category_id: null, type: "income", merchant: "테스트수입" }));
    const { body: hidden } = await create(fetch, payload({ category_id: null, merchant: "테스트숨김" }));
    app.db.query("UPDATE transactions SET hidden=1 WHERE id=?").run(hidden.id);
    const { body: deleted } = await create(fetch, payload({ category_id: null, merchant: "테스트삭제" }));
    app.db.query("UPDATE transactions SET deleted_at=updated_at WHERE id=?").run(deleted.id);
    await create(
      fetch,
      payload({ category_id: null, merchant: "테스트기간밖", occurred_at: "2026-09-04T09:00:00+09:00" }),
    );
    const query = "category_id=uncategorized&type=expense&from=2026-10-01&to=2026-10-31";
    const response = await fetch(`/api/v1/transactions?${query}`);
    expect(response.status).toBe(200);
    const list = await response.json();
    expect(list.items.map((row: { id: string }) => row.id)).toEqual([unassigned.id]);
    expect(list.totals).toEqual({ count: 1, income: 0, expense: 4500, net: -4500 });
    for (const format of ["csv", "xlsx"]) {
      const exported = await fetch(`/api/v1/export?${query}&format=${format}`);
      expect(exported.status).toBe(200);
      const form = new FormData();
      form.set("file", new File([await exported.arrayBuffer()], `ledger.${format}`));
      const preview = await fetch("/api/v1/import/preview", { method: "POST", body: form });
      expect(preview.status).toBe(200);
      const plan = await preview.json();
      expect(plan.counts.total).toBe(1);
      expect(plan.rows[0].merchant).toBe("테스트미분류");
    }
  });

  test("creates with defaults and lists totals, excluding hidden and deleted rows", async () => {
    const app = setup();
    const fetch = await authed(app);
    const { response, body: created } = await create(fetch);
    expect(response.status).toBe(201);
    expect(created).toMatchObject({
      type: "expense",
      amount: 4500,
      merchant: "샘플카페",
      merchant_key: "샘플카페",
      source: "manual",
      is_refund: false,
      currency: "KRW",
    });
    expect(created.asset_id).toBeTruthy();
    await create(fetch, payload({ type: "income", amount: 12000, occurred_at: "2026-10-05T09:00:00+09:00" }));
    const hidden = await create(fetch, payload({ amount: 700 }));
    app.db.query("UPDATE transactions SET hidden=1 WHERE id=?").run(hidden.body.id);
    const list = await fetch("/api/v1/transactions?from=2026-10-01&to=2026-10-31");
    const body = await list.json();
    expect(list.status).toBe(200);
    expect(body.items).toHaveLength(2);
    expect(body.totals).toEqual({ income: 12000, expense: 4500, net: 7500, count: 2 });
    expect(body.next_cursor).toBeNull();
  });

  test("filters every supported field, hidden mode, category descendants and cursor", async () => {
    const app = setup();
    const fetch = await authed(app);
    const parent = app.db
      .query<{ id: string }, []>("SELECT id FROM categories WHERE name='식비' AND parent_id IS NULL")
      .get();
    assert(parent, "Seeded food category missing");
    const child = app.db
      .query<{ id: string }, [string]>("SELECT id FROM categories WHERE name='카페' AND parent_id=?")
      .get(parent.id);
    assert(child, "Seeded cafe category missing");
    const bankId = Bun.randomUUIDv7();
    const now = "2026-10-01T00:00:00+09:00";
    app.db
      .query("INSERT INTO assets(id,name,kind,group_name,created_at,updated_at) VALUES(?,'테스트은행','bank','',?,?)")
      .run(bankId, now, now);
    const matching = payload({ category_id: child.id, asset_id: bankId });
    const { body: first } = await create(fetch, matching);
    await create(
      fetch,
      payload({ category_id: child.id, asset_id: bankId, memo: "찾을메모", occurred_at: "2026-10-05T09:00:00+09:00" }),
    );
    const hidden = await create(fetch, payload({ category_id: child.id, asset_id: bankId }));
    app.db.query("UPDATE transactions SET hidden=1 WHERE id=?").run(hidden.body.id);
    await create(fetch, payload({ category_id: child.id, asset_id: bankId, amount: 9000 }));
    await create(fetch, payload({ category_id: child.id, asset_id: bankId, occurred_at: "2026-10-06T09:00:00+09:00" }));
    const query = new URLSearchParams({
      from: "2026-10-01",
      to: "2026-10-04",
      q: "샘플카페",
      type: "expense",
      category_id: parent.id,
      asset_id: bankId,
      min: "4000",
      max: "5000",
      source: "manual",
      limit: "1",
    });
    const response = await fetch(`/api/v1/transactions?${query}`);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe(first.id);
    expect(body.totals).toMatchObject({ expense: 4500, count: 1 });
    expect(body.next_cursor).toBeNull();

    const included = await fetch(`/api/v1/transactions?hidden=include&asset_id=${bankId}`);
    const includedBody = await included.json();
    expect(includedBody.items).toHaveLength(5);
    const only = await fetch(`/api/v1/transactions?hidden=only&asset_id=${bankId}`);
    expect((await only.json()).items).toHaveLength(1);
    const memo = await fetch("/api/v1/transactions?q=찾을메모");
    expect((await memo.json()).items).toHaveLength(1);
    const page = await fetch(`/api/v1/transactions?asset_id=${bankId}&limit=2`);
    const pageBody = await page.json();
    expect(pageBody.items).toHaveLength(2);
    expect(pageBody.next_cursor).toBeString();
    const nextPage = await fetch(`/api/v1/transactions?asset_id=${bankId}&limit=2&cursor=${pageBody.next_cursor}`);
    expect((await nextPage.json()).items).toHaveLength(2);
  });

  test("refund reduces expense totals and rejects invalid or same-asset transfers", async () => {
    const fetch = await authed(setup());
    await create(fetch, payload({ amount: 9000 }));
    await create(fetch, payload({ amount: 2000, is_refund: true }));
    const response = await fetch("/api/v1/transactions");
    expect((await response.json()).totals.expense).toBe(7000);
    const invalidAmount = await create(fetch, payload({ amount: -1 }));
    expect(invalidAmount.response.status).toBe(400);
    const asset = (await (await fetch("/api/v1/transactions")).json()).items[0].asset_id;
    const sameAsset = await create(fetch, payload({ type: "transfer", asset_id: asset, to_asset_id: asset }));
    expect(sameAsset.response.status).toBe(400);
  });

  test("patch locks changed fields, learns rules and applies category to unlocked past rows", async () => {
    const app = setup();
    const fetch = await authed(app);
    const { body: first } = await create(fetch);
    const { body: second } = await create(fetch, payload({ occurred_at: "2026-10-05T09:00:00+09:00" }));
    const category = app.db
      .query<{ id: string }, []>("SELECT id FROM categories WHERE name='식사' AND type='expense'")
      .get();
    assert(category, "Seeded meal category missing");
    const response = await fetch(`/api/v1/transactions/${first.id}`, {
      method: "PATCH",
      body: { category_id: category.id, apply_to_past: true },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ category_id: category.id, user_locked: ["category_id"] });
    expect(
      app.db.query<{ category_id: string }, [string]>("SELECT category_id FROM transactions WHERE id=?").get(second.id)
        ?.category_id,
    ).toBe(category.id);
    expect(
      app.db
        .query("SELECT 1 FROM merchant_rules WHERE merchant_key='샘플카페' AND category_id=? AND type='expense'")
        .get(category.id),
    ).toBeTruthy();
  });

  test("delete hides row, restore returns it, and idempotent replay is identical", async () => {
    const fetch = await authed(setup());
    const { body: created } = await create(fetch);
    const deletion = await fetch(`/api/v1/transactions/${created.id}`, {
      method: "DELETE",
      headers: { "Idempotency-Key": "delete-once" },
    });
    const deleted = await deletion.json();
    expect(deletion.status).toBe(200);
    expect((await (await fetch("/api/v1/transactions")).json()).items).toHaveLength(0);
    const replay = await fetch(`/api/v1/transactions/${created.id}`, {
      method: "DELETE",
      headers: { "Idempotency-Key": "delete-once" },
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(deleted);
    const restored = await fetch(`/api/v1/transactions/${created.id}/restore`, {
      method: "POST",
      headers: { "Idempotency-Key": "restore-once" },
    });
    expect(restored.status).toBe(200);
    expect((await (await fetch("/api/v1/transactions")).json()).items).toHaveLength(1);
  });
});
