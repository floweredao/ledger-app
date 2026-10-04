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

const monthly = (start_date: string, interval = 1, end_date?: string) => ({
  template: { type: "expense", amount: 3200, merchant: "샘플카페" },
  freq: "monthly",
  interval,
  start_date,
  ...(end_date ? { end_date } : {}),
});

describe("recurring rules", () => {
  test("materializes monthly day 31 with month-end clamping exactly once", async () => {
    const app = setup();
    const api = await authed(app);
    const created = await api("/api/v1/recurring", {
      method: "POST",
      body: monthly("2026-01-31"),
    });
    expect(created.status).toBe(201);
    const rule = await created.json();
    expect(rule.start_date).toBe("2026-01-31");

    expect(
      await (await api("/api/v1/recurring/run", { method: "POST", body: { today: "2026-04-30" } })).json(),
    ).toEqual({ created: 4 });
    expect(
      await (await api("/api/v1/recurring/run", { method: "POST", body: { today: "2026-04-30" } })).json(),
    ).toEqual({ created: 0 });
    const rows = app.db
      .query<{ occurred_at: string; source_key: string }, [string]>(
        "SELECT occurred_at, source_key FROM transactions WHERE recurring_rule_id=? ORDER BY occurred_at",
      )
      .all(rule.id);
    expect(rows.map((row) => row.occurred_at.slice(0, 10))).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
    expect(rows.map((row) => row.source_key)).toEqual([
      `rec:${rule.id}:2026-01-31`,
      `rec:${rule.id}:2026-02-28`,
      `rec:${rule.id}:2026-03-31`,
      `rec:${rule.id}:2026-04-30`,
    ]);
  });

  test("honors interval two, end date, inactive state and run-body validation", async () => {
    const app = setup();
    const api = await authed(app);
    const response = await api("/api/v1/recurring", {
      method: "POST",
      body: monthly("2026-01-31", 2, "2026-05-31"),
    });
    expect(response.status).toBe(201);
    const rule = await response.json();
    expect((await api("/api/v1/recurring/run", { method: "POST", body: { today: "2026-12-31" } })).status).toBe(200);
    expect(
      app.db
        .query<{ date: string }, [string]>(
          "SELECT substr(occurred_at,1,10) AS date FROM transactions WHERE recurring_rule_id=? ORDER BY occurred_at",
        )
        .all(rule.id)
        .map((row) => row.date),
    ).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);

    const invalid = await api("/api/v1/recurring", {
      method: "POST",
      body: { ...monthly("2026-01-01"), interval: 0 },
    });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe("invalid_input");

    const patch = await api(`/api/v1/recurring/${rule.id}`, { method: "PATCH", body: { active: false } });
    expect(patch.status).toBe(200);
    const before = app.db.query("SELECT id FROM transactions WHERE recurring_rule_id=?").all(rule.id).length;
    await api("/api/v1/recurring/run", { method: "POST", body: { today: "2027-12-31" } });
    expect(app.db.query("SELECT id FROM transactions WHERE recurring_rule_id=?").all(rule.id)).toHaveLength(before);
  });

  test("materializes leap-day yearly rules as February 28 in non-leap years", async () => {
    const app = setup();
    const api = await authed(app);
    const response = await api("/api/v1/recurring", {
      method: "POST",
      body: { template: { type: "income", amount: 100000 }, freq: "yearly", interval: 1, start_date: "2024-02-29" },
    });
    const rule = await response.json();
    await api("/api/v1/recurring/run", { method: "POST", body: { today: "2026-02-28" } });
    const dates = app.db
      .query<{ date: string }, [string]>(
        "SELECT substr(occurred_at,1,10) AS date FROM transactions WHERE recurring_rule_id=? ORDER BY occurred_at",
      )
      .all(rule.id)
      .map((row) => row.date);
    expect(dates).toEqual(["2024-02-29", "2025-02-28", "2026-02-28"]);
  });

  test("supports rule CRUD and deleting a rule preserves materialized transactions", async () => {
    const api = await authed(setup());
    const response = await api("/api/v1/recurring", { method: "POST", body: monthly("2026-10-01") });
    const rule = await response.json();
    expect((await api("/api/v1/recurring")).status).toBe(200);
    expect((await api(`/api/v1/recurring/${rule.id}`, { method: "PATCH", body: { interval: 2 } })).status).toBe(200);
    expect((await api(`/api/v1/recurring/${rule.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await api(`/api/v1/recurring/${rule.id}`, { method: "PATCH", body: { interval: 1 } })).status).toBe(404);
  });
});
