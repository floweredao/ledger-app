import { afterEach, describe, expect, test } from "bun:test";
import { insertTransaction } from "../server/domain/tx-core";
import { TransactionInputSchema } from "../shared/schema";
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

describe("stats and calendar API", () => {
  test("aggregates periods, categories, trends, comparisons, merchants, assets, and calendar", async () => {
    const app = setup();
    const fetch = await authed(app);
    const cash = required(app.db.query<{ id: string }, []>("SELECT id FROM assets WHERE kind='cash' LIMIT 1").get()).id;
    const destination = crypto.randomUUID();
    app.db
      .query(
        "INSERT INTO assets(id,name,kind,group_name,opening_balance,created_at,updated_at) VALUES(?,?,'bank','',0,?,?)",
      )
      .run(destination, "테스트계좌", "2026-01-01T00:00:00+09:00", "2026-01-01T00:00:00+09:00");
    const food = required(
      app.db
        .query<{ id: string }, []>(
          "SELECT id FROM categories WHERE type='expense' AND name='식비' AND parent_id IS NULL",
        )
        .get(),
    ).id;
    const cafe = required(
      app.db
        .query<{ id: string }, [string]>(
          "SELECT id FROM categories WHERE type='expense' AND name='카페' AND parent_id=?",
        )
        .get(food),
    ).id;
    const income = required(
      app.db
        .query<{ id: string }, []>(
          "SELECT id FROM categories WHERE type='income' AND name='급여' AND parent_id IS NULL",
        )
        .get(),
    ).id;
    const put = (
      date: string,
      type: "expense" | "income" | "transfer",
      amount: number,
      category_id: string | null,
      merchant = "",
      extra: Record<string, unknown> = {},
    ) =>
      insertTransaction(
        app.db,
        TransactionInputSchema.parse({
          type,
          occurred_at: `${date}T12:00:00+09:00`,
          amount,
          asset_id: cash,
          ...(category_id ? { category_id } : {}),
          merchant,
          ...extra,
        }),
        { now: `${date}T12:00:00+09:00` },
      );

    // Thirty deterministic rows cover current/previous periods, refunds, hidden/deleted rows and transfers.
    for (let day = 1; day <= 12; day++)
      put(`2026-10-${String(day).padStart(2, "0")}`, "expense", 1000, food, "테스트마트");
    put("2026-10-13", "expense", 500, cafe, "샘플카페");
    put("2026-10-14", "income", 10000, income, "급여");
    put("2026-10-15", "expense", 2000, food, "테스트마트", { is_refund: true });
    put("2026-10-16", "transfer", 7000, null, "이체", { to_asset_id: destination });
    for (let day = 1; day <= 8; day++)
      put(`2026-09-${String(day).padStart(2, "0")}`, "expense", 500, food, "테스트마트");
    put("2026-09-09", "income", 4000, income, "급여");
    const hiddenRow = put("2026-10-17", "expense", 9000, food, "숨김");
    app.db.query("UPDATE transactions SET hidden=1 WHERE id=?").run(hiddenRow.id);
    const deleted = put("2026-10-18", "expense", 8000, food, "삭제됨");
    app.db.query("UPDATE transactions SET deleted_at='2026-10-19T00:00:00+09:00' WHERE id=?").run(deleted.id);
    for (let day = 20; day <= 25; day++) put(`2026-10-${day}`, "expense", 100, cafe, "샘플카페");

    const summary = await (await fetch("/api/v1/stats/summary?from=2026-10-01&to=2026-10-31")).json();
    expect(summary).toEqual({ income: 10000, expense: 11100, net: -1100, count: 21 });

    const categories = await (
      await fetch("/api/v1/stats/categories?from=2026-10-01&to=2026-10-31&type=expense")
    ).json();
    expect(categories.total).toBe(11100);
    expect(categories.rows[0]).toMatchObject({ category_id: food, amount: 11100, pct: 100 });
    expect(categories.rows[0].children[0]).toMatchObject({ category_id: cafe, amount: 1100 });

    const trend = await (await fetch("/api/v1/stats/trend?months=2&end=2026-10&type=expense")).json();
    expect(trend.buckets).toHaveLength(2);
    expect(trend.buckets.map((row: { month: string; expense: number }) => [row.month, row.expense])).toEqual([
      ["2026-09", 4000],
      ["2026-10", 11100],
    ]);

    const compare = await (await fetch("/api/v1/stats/compare?from=2026-10-01&to=2026-10-31&type=expense")).json();
    expect(compare.range).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(compare.previous_range).toEqual({ from: "2026-08-31", to: "2026-09-30" });
    expect(compare.rows.find((row: { category_id: string }) => row.category_id === food)).toMatchObject({
      current: 10000,
      previous: 4000,
      delta: 6000,
      pct_change: 150,
    });

    const merchants = await (await fetch("/api/v1/stats/merchants?from=2026-10-01&to=2026-10-31&limit=1")).json();
    expect(merchants.rows).toHaveLength(1);
    expect(merchants.rows[0]).toMatchObject({ merchant: "테스트마트", amount: 10000, count: 13 });

    const assets = await (await fetch("/api/v1/stats/assets?from=2026-10-01&to=2026-10-31")).json();
    expect(assets.rows).toContainEqual({ asset_id: cash, name: "현금", income: 10000, expense: 11100 });

    const calendar = await (await fetch("/api/v1/stats/calendar?month=2026-10")).json();
    expect(calendar.days).toHaveLength(31);
    expect(calendar.days[0]).toEqual({ date: "2026-10-01", income: 0, expense: 1000, count: 1 });
    expect(calendar.days[14]).toEqual({ date: "2026-10-15", income: 0, expense: -2000, count: 1 });
    expect(calendar.days[19]).toEqual({ date: "2026-10-20", income: 0, expense: 100, count: 1 });
  });

  test("rejects invalid trend bounds and malformed calendar months", async () => {
    const fetch = await authed(setup());
    expect((await fetch("/api/v1/stats/trend?months=0")).status).toBe(400);
    expect((await fetch("/api/v1/stats/calendar?month=2026-13")).status).toBe(400);
  });
});

function required<T>(value: T | null): T {
  if (value === null) throw new Error("Expected seeded test fixture");
  return value;
}
