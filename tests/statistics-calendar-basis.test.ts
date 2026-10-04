import { expect, test } from "bun:test";
import { authed, makeTestApp } from "./helpers";

test("calendar trend does not inherit the accounting month start", async () => {
  const app = makeTestApp();
  try {
    const request = await authed(app);
    await request("/api/v1/settings", { method: "PATCH", body: { month_start_day: 25 } });
    for (const [day, amount] of [
      ["04", 1000],
      ["26", 2000],
    ] as const) {
      const created = await request("/api/v1/transactions", {
        method: "POST",
        body: { type: "expense", amount, occurred_at: `2026-10-${day}T12:00:00+09:00`, merchant: "테스트마트" },
      });
      expect(created.status).toBe(201);
    }
    const accounting = await (await request("/api/v1/stats/trend?months=1&end=2026-10")).json();
    expect(accounting.buckets[0]).toMatchObject({ from: "2026-10-25", expense: 2000 });
    const calendar = await (await request("/api/v1/stats/trend?months=1&end=2026-10&basis=calendar")).json();
    expect(calendar.buckets[0]).toMatchObject({ from: "2026-10-01", to: "2026-11-01", expense: 3000 });
    expect((await request("/api/v1/stats/trend?basis=invalid")).status).toBe(400);
  } finally {
    app.cleanup();
  }
});
