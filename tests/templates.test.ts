import { afterEach, describe, expect, test } from "bun:test";
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

describe("transaction templates", () => {
  test("creates, orders, patches, uses and deletes templates", async () => {
    const app = setup();
    const api = await authed(app);
    const payload = { type: "expense", amount: 4500, merchant: "테스트마트", memo: "주간 장보기" };
    const first = await api("/api/v1/templates", {
      method: "POST",
      body: { name: "장보기", payload, sort: 2 },
    });
    expect(first.status).toBe(201);
    const template = await first.json();

    const second = await api("/api/v1/templates", {
      method: "POST",
      body: { name: "빠른 커피", payload: { type: "expense", amount: 1800, merchant: "샘플카페" }, sort: 0 },
    });
    expect(second.status).toBe(201);
    expect((await (await api("/api/v1/templates")).json()).items.map((item: { name: string }) => item.name)).toEqual([
      "빠른 커피",
      "장보기",
    ]);

    const used = await api(`/api/v1/templates/${template.id}/use`, {
      method: "POST",
      body: { occurred_at: "2026-10-03T09:30:00+09:00", amount: 5200 },
    });
    expect(used.status).toBe(201);
    const transaction = await used.json();
    expect(transaction).toMatchObject({
      type: "expense",
      amount: 5200,
      occurred_at: "2026-10-03T09:30:00+09:00",
      merchant: "테스트마트",
      source: "manual",
    });
    expect(app.db.query("SELECT id FROM transactions WHERE id=?").get(transaction.id)).toBeTruthy();
    expect(
      app.db.query<{ use_count: number }, [string]>("SELECT use_count FROM templates WHERE id=?").get(template.id),
    ).toEqual({ use_count: 1 });

    expect(
      (await api(`/api/v1/templates/${template.id}`, { method: "PATCH", body: { name: "장보기 빠른 입력" } })).status,
    ).toBe(200);
    expect((await api(`/api/v1/templates/${template.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await api(`/api/v1/templates/${template.id}/use`, { method: "POST", body: {} })).status).toBe(404);
  });

  test("rejects invalid payloads and invalid transaction overrides", async () => {
    const api = await authed(setup());
    const badTemplate = await api("/api/v1/templates", {
      method: "POST",
      body: { name: "잘못된 입력", payload: { type: "expense", amount: -10 } },
    });
    expect(badTemplate.status).toBe(400);
    expect((await badTemplate.json()).error.code).toBe("invalid_input");

    const created = await api("/api/v1/templates", {
      method: "POST",
      body: { name: "유효 입력", payload: { type: "expense", amount: 1000 } },
    });
    const template = await created.json();
    const badUse = await api(`/api/v1/templates/${template.id}/use`, {
      method: "POST",
      body: { amount: -1 },
    });
    expect(badUse.status).toBe(400);
    expect((await badUse.json()).error.code).toBe("invalid_input");
  });
});
