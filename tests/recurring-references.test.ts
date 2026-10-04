import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { startRecurringJob } from "../server/jobs/recurring";
import { authed, makeTestApp, type TestApp } from "./helpers";

const apps: TestApp[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.cleanup();
});
const setup = async () => {
  const app = makeTestApp();
  apps.push(app);
  return { app, api: await authed(app) };
};
const payload = { type: "expense", amount: 1000, merchant: "샘플카페" };

for (const kind of ["recurring", "templates"] as const) {
  const field = kind === "recurring" ? "template" : "payload";
  const body = (value: object) =>
    kind === "recurring"
      ? { template: value, freq: "monthly", start_date: "2026-10-01", active: false }
      : { name: "테스트 입력", payload: value };

  describe(`${kind} reference integrity`, () => {
    test("preserves optional and null references and partial favorite payloads", async () => {
      const { api } = await setup();
      const value = { type: "expense", asset_id: null, to_asset_id: null, category_id: null };
      const created = await api(`/api/v1/${kind}`, {
        method: "POST",
        body: body(kind === "recurring" ? { ...value, amount: 1000 } : value),
      });
      expect(created.status).toBe(201);
      const row = await created.json();
      expect(row[field].asset_id).toBeNull();
      if (kind === "templates") expect(row[field].amount).toBeUndefined();
    });
    for (const reference of ["asset_id", "to_asset_id", "category_id"] as const) {
      test(`rejects missing ${reference} on create and patch without changing persisted data`, async () => {
        const { app, api } = await setup();
        const invalid = { ...payload, [reference]: Bun.randomUUIDv7() };
        const rejected = await api(`/api/v1/${kind}`, { method: "POST", body: body(invalid) });
        expect(rejected.status).toBe(400);
        expect(app.db.query(`SELECT id FROM ${kind === "recurring" ? "recurring_rules" : kind}`).all()).toEqual([]);
        const created = await api(`/api/v1/${kind}`, { method: "POST", body: body(payload) });
        expect(created.status).toBe(201);
        const row = await created.json();
        const patch = await api(`/api/v1/${kind}/${row.id}`, {
          method: "PATCH",
          body: { [field]: invalid },
        });
        expect(patch.status).toBe(400);
        const items = (await (await api(`/api/v1/${kind}`)).json()).items;
        expect(items[0]).toEqual(row);
      });
    }

    for (const reference of ["asset_id", "to_asset_id"] as const) {
      test(`blocks deleting an asset referenced only by ${reference}`, async () => {
        const { api } = await setup();
        const asset = await (
          await api("/api/v1/assets", { method: "POST", body: { name: "테스트 자산", kind: "bank" } })
        ).json();
        expect(
          (await api(`/api/v1/${kind}`, { method: "POST", body: body({ ...payload, [reference]: asset.id }) })).status,
        ).toBe(201);
        const deleted = await api(`/api/v1/assets/${asset.id}`, { method: "DELETE" });
        expect(deleted.status).toBe(409);
        expect((await deleted.json()).error.code).toBe("in_use");
      });
    }

    test("blocks deleting a referenced category and atomically reassigns stored payloads", async () => {
      const { app, api } = await setup();
      const category = await (
        await api("/api/v1/categories", { method: "POST", body: { name: "테스트 원본", type: "expense" } })
      ).json();
      const target = await (
        await api("/api/v1/categories", { method: "POST", body: { name: "테스트 대상", type: "expense" } })
      ).json();
      const created = await api(`/api/v1/${kind}`, {
        method: "POST",
        body: body({ ...payload, category_id: category.id }),
      });
      expect(created.status).toBe(201);
      const row = await created.json();
      expect((await api(`/api/v1/categories/${category.id}`, { method: "DELETE" })).status).toBe(409);
      expect(
        (await api(`/api/v1/categories/${category.id}?reassign_to=${target.id}`, { method: "DELETE" })).status,
      ).toBe(200);
      const items = (await (await api(`/api/v1/${kind}`)).json()).items;
      expect(items[0][field]).toEqual({ ...row[field], category_id: target.id });
      if (kind === "recurring") {
        await api(`/api/v1/recurring/${row.id}`, { method: "PATCH", body: { active: true } });
        setSystemTime(new Date("2026-10-03T12:00:00+09:00"));
        try {
          const stop = startRecurringJob(app.db);
          stop();
        } finally {
          setSystemTime();
        }
        expect(
          await (await api("/api/v1/recurring/run", { method: "POST", body: { today: "2026-10-01" } })).json(),
        ).toEqual({ created: 0 });
        expect(
          await (await api("/api/v1/recurring/run", { method: "POST", body: { today: "2026-10-01" } })).json(),
        ).toEqual({ created: 0 });
        const transactions = (await (await api("/api/v1/transactions")).json()).items;
        expect(transactions).toHaveLength(1);
        expect(transactions[0].category_id).toBe(target.id);
      } else {
        const used = await api(`/api/v1/templates/${row.id}/use`, { method: "POST", body: {} });
        expect(used.status).toBe(201);
        expect((await used.json()).category_id).toBe(target.id);
      }
    });
  });
}
