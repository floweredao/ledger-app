import { afterEach, expect, test } from "bun:test";
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
