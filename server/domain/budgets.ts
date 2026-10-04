import type { Database } from "bun:sqlite";
import { addDays, monthRange } from "../../shared/dates";
import { type BudgetStatus, BudgetStatusSchema } from "../../shared/schema";

type BudgetRow = { id: string; category_id: string; month: string; amount: number };
type CategoryRow = { id: string; name: string; icon: string | null; color: string | null };
type SpendRow = { category_id: string; spent: number };

export function getBudgetStatus(db: Database, month: string): BudgetStatus {
  const startDayRow = db.query<{ value: string }, []>("SELECT value FROM settings WHERE key='month_start_day'").get();
  const startDay = Number(startDayRow ? JSON.parse(startDayRow.value) : 1);
  const halfOpenRange = monthRange(month, startDay);
  const range = { from: halfOpenRange.from, to: addDays(halfOpenRange.to, -1) };
  const budgets = db
    .query<BudgetRow, [string]>("SELECT id, category_id, month, amount FROM budgets WHERE month IN ('', ?)")
    .all(month);
  const budgetByCategory = new Map<string, { default?: BudgetRow; override?: BudgetRow }>();
  for (const budget of budgets) {
    const values = budgetByCategory.get(budget.category_id) ?? {};
    if (budget.month === "") values.default = budget;
    else values.override = budget;
    budgetByCategory.set(budget.category_id, values);
  }
  const spentRows = db
    .query<SpendRow, [string, string]>(
      `SELECT t.category_id, SUM(CASE WHEN t.is_refund=1 THEN -t.amount ELSE t.amount END) AS spent
       FROM transactions t
       WHERE t.type='expense' AND t.deleted_at IS NULL AND t.hidden=0
         AND t.occurred_at >= ? AND t.occurred_at < ?
       GROUP BY t.category_id`,
    )
    .all(`${halfOpenRange.from}T00:00:00+09:00`, `${halfOpenRange.to}T00:00:00+09:00`);
  const spentByCategory = new Map(spentRows.map((row) => [row.category_id, row.spent]));
  const categoryRows = db
    .query<CategoryRow, []>(
      "SELECT id, name, icon, color FROM categories WHERE type='expense' AND hidden=0 ORDER BY sort, name",
    )
    .all();
  const childrenByParent = new Map<string, string[]>();
  for (const child of db
    .query<{ id: string; parent_id: string }, []>(
      "SELECT id, parent_id FROM categories WHERE type='expense' AND parent_id IS NOT NULL AND hidden=0",
    )
    .all()) {
    const children = childrenByParent.get(child.parent_id) ?? [];
    children.push(child.id);
    childrenByParent.set(child.parent_id, children);
  }
  const totalSpent = spentRows.reduce((sum, row) => sum + row.spent, 0);
  const totalBudget = budgetByCategory.get("")?.override ?? budgetByCategory.get("")?.default;
  const line = (configured: BudgetRow | undefined, spent: number) => {
    const budget = configured?.amount ?? null;
    return {
      budget_id: configured?.id ?? null,
      budget_month: configured?.month ?? null,
      budget,
      spent,
      remaining: budget === null ? null : budget - spent,
      pct: budget === null ? null : budget === 0 ? (spent > 0 ? 100 : 0) : Math.round((spent / budget) * 10000) / 100,
      over: budget !== null && spent > budget,
    };
  };
  const categories = categoryRows
    .map((category) => {
      const childIds = childrenByParent.get(category.id) ?? [];
      const spent = [category.id, ...childIds].reduce((sum, id) => sum + (spentByCategory.get(id) ?? 0), 0);
      const configured = budgetByCategory.get(category.id);
      return {
        category_id: category.id,
        name: category.name,
        icon: category.icon,
        color: category.color,
        ...line(configured?.override ?? configured?.default, spent),
      };
    })
    .filter((category) => category.budget !== null || category.spent !== 0)
    .sort((a, b) => {
      const aBudgeted = a.budget !== null;
      const bBudgeted = b.budget !== null;
      return aBudgeted === bBudgeted
        ? aBudgeted
          ? (b.pct ?? 0) - (a.pct ?? 0)
          : b.spent - a.spent
        : aBudgeted
          ? -1
          : 1;
    });

  return BudgetStatusSchema.parse({
    month,
    range,
    total: line(totalBudget, totalSpent),
    categories,
  });
}

export function upsertBudget(db: Database, input: { category_id: string; month: string; amount: number }): BudgetRow {
  const existing = db
    .query<{ id: string }, [string, string]>("SELECT id FROM budgets WHERE category_id=? AND month=?")
    .get(input.category_id, input.month);
  const id = existing?.id ?? Bun.randomUUIDv7();
  db.query(
    `INSERT INTO budgets(id,category_id,month,amount) VALUES(?,?,?,?)
     ON CONFLICT(category_id,month) DO UPDATE SET amount=excluded.amount`,
  ).run(id, input.category_id, input.month, input.amount);
  return db
    .query<BudgetRow, [string]>("SELECT id, category_id, month, amount FROM budgets WHERE id=?")
    .get(id) as BudgetRow;
}

export function deleteBudget(db: Database, id: string): boolean {
  return db.query("DELETE FROM budgets WHERE id=?").run(id).changes > 0;
}
