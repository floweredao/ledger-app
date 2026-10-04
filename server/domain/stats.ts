import type { Database } from "bun:sqlite";
import { addMonths, daysInMonth, kstMonth, monthRange } from "../../shared/dates";
import type { TransactionType } from "../../shared/schema";

type Range = { from: string; to: string };
type Filter = Range & { type?: TransactionType; include_hidden?: boolean };
type RawStatRow = {
  id: string;
  occurred_at: string;
  type: TransactionType;
  amount: number;
  is_refund: number;
  hidden: number;
  category_id: string | null;
  asset_id: string | null;
  merchant: string;
  merchant_key: string;
};
type CategoryRow = { id: string; name: string; icon: string | null; color: string | null; parent_id: string | null };

function loadRows(db: Database, range: Range, type?: TransactionType, includeHidden = false): RawStatRow[] {
  const clauses = ["occurred_at >= ?", "occurred_at < ?", "deleted_at IS NULL", "type != 'transfer'"];
  const values: (string | number)[] = [`${range.from}T00:00:00+09:00`, `${range.to}T00:00:00+09:00`];
  if (!includeHidden) clauses.push("hidden=0");
  if (type) {
    clauses.push("type=?");
    values.push(type);
  }
  return db
    .query<RawStatRow, (string | number)[]>(
      `SELECT id,occurred_at,type,amount,is_refund,hidden,category_id,asset_id,merchant,merchant_key
       FROM transactions WHERE ${clauses.join(" AND ")}`,
    )
    .all(...values);
}

const signedExpense = (row: RawStatRow) => (row.is_refund ? -row.amount : row.amount);
const totals = (rows: RawStatRow[]) => {
  const income = rows.reduce((sum, row) => sum + (row.type === "income" ? row.amount : 0), 0);
  const expense = rows.reduce((sum, row) => sum + (row.type === "expense" ? signedExpense(row) : 0), 0);
  return { income, expense, net: income - expense, count: rows.length };
};
const dayFor = (value: string) => value.slice(0, 10);
const categoryList = (db: Database) =>
  db.query<CategoryRow, []>("SELECT id,name,icon,color,parent_id FROM categories ORDER BY sort,name").all();

export function statsSummary(db: Database, range: Range, type?: TransactionType, includeHidden = false) {
  return totals(loadRows(db, range, type, includeHidden));
}

export function statsCategories(db: Database, filter: Filter) {
  const rows = loadRows(db, filter, filter.type, filter.include_hidden);
  const categories = categoryList(db);
  const byId = new Map(categories.map((category) => [category.id, category]));
  const sums = new Map<string | null, number>();
  for (const row of rows) {
    const amount = row.type === "expense" ? signedExpense(row) : row.amount;
    const category = row.category_id ? byId.get(row.category_id) : undefined;
    const id = category?.parent_id ?? category?.id ?? null;
    sums.set(id, (sums.get(id) ?? 0) + amount);
  }
  const total = [...sums.values()].reduce((sum, amount) => sum + amount, 0);
  const rowsOut = [...sums.entries()]
    .map(([id, amount]) => {
      const category = id ? byId.get(id) : undefined;
      const children = categories
        .filter((child) => child.parent_id === id)
        .map((child) => ({
          category_id: child.id,
          name: child.name,
          icon: child.icon,
          color: child.color,
          amount: rows
            .filter((row) => row.category_id === child.id)
            .reduce((sum, row) => sum + (row.type === "expense" ? signedExpense(row) : row.amount), 0),
          pct: total === 0 ? 0 : (100 * amountForCategory(rows, child.id)) / total,
        }))
        .filter((child) => child.amount !== 0)
        .sort((a, b) => b.amount - a.amount);
      return {
        category_id: id,
        name: category?.name ?? "미분류",
        icon: category?.icon ?? null,
        color: category?.color ?? null,
        amount,
        pct: total === 0 ? 0 : (100 * amount) / total,
        children,
      };
    })
    .sort((a, b) => b.amount - a.amount);
  return { total, rows: rowsOut };
}

function amountForCategory(rows: RawStatRow[], id: string) {
  return rows
    .filter((row) => row.category_id === id)
    .reduce((sum, row) => sum + (row.type === "expense" ? signedExpense(row) : row.amount), 0);
}

export function statsTrend(db: Database, months: number, end = kstMonth(), startDay = 1, type?: TransactionType) {
  const start = addMonths(end, 1 - months);
  const range = { from: monthRange(start, startDay).from, to: monthRange(addMonths(end, 1), startDay).from };
  const rows = loadRows(db, range, type);
  return {
    buckets: Array.from({ length: months }, (_, index) => {
      const month = addMonths(start, index);
      const bounds = monthRange(month, startDay);
      const selected = rows.filter(
        (row) => row.occurred_at >= `${bounds.from}T00:00:00+09:00` && row.occurred_at < `${bounds.to}T00:00:00+09:00`,
      );
      const sums = totals(selected);
      return { month, from: bounds.from, to: bounds.to, income: sums.income, expense: sums.expense, net: sums.net };
    }),
  };
}

export function statsCompare(db: Database, range: Range, type?: TransactionType) {
  const inclusiveTo = new Date(`${range.to}T00:00:00Z`);
  inclusiveTo.setUTCDate(inclusiveTo.getUTCDate() - 1);
  const dayCount = Math.round((inclusiveTo.getTime() - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1;
  const previousToDate = new Date(Date.parse(`${range.from}T00:00:00Z`));
  previousToDate.setUTCDate(previousToDate.getUTCDate() - 1);
  const previousFromDate = new Date(previousToDate.getTime());
  previousFromDate.setUTCDate(previousFromDate.getUTCDate() - dayCount + 1);
  const previousRange = {
    from: previousFromDate.toISOString().slice(0, 10),
    to: previousToDate.toISOString().slice(0, 10),
  };
  const currentRows = loadRows(db, { from: range.from, to: range.to }, type);
  const previousRows = loadRows(db, { from: previousRange.from, to: range.from }, type);
  const categories = categoryList(db);
  const names = new Map(categories.map(({ id, name }) => [id, name]));
  const sumByCategory = (rows: RawStatRow[]) => {
    const map = new Map<string | null, number>();
    for (const row of rows) {
      const amount = row.type === "expense" ? signedExpense(row) : row.amount;
      map.set(row.category_id, (map.get(row.category_id) ?? 0) + amount);
    }
    return map;
  };
  const current = sumByCategory(currentRows);
  const previous = sumByCategory(previousRows);
  const ids = new Set([...current.keys(), ...previous.keys()]);
  return {
    range: { from: range.from, to: inclusiveTo.toISOString().slice(0, 10) },
    previous_range: previousRange,
    rows: [...ids]
      .map((id) => {
        const now = current.get(id) ?? 0;
        const before = previous.get(id) ?? 0;
        return {
          category_id: id,
          name: id ? (names.get(id) ?? "미분류") : "미분류",
          current: now,
          previous: before,
          delta: now - before,
          pct_change: before === 0 ? null : (100 * (now - before)) / Math.abs(before),
        };
      })
      .sort((a, b) => b.current - a.current),
  };
}

export function statsMerchants(db: Database, range: Range, limit: number) {
  const rows = loadRows(db, range, "expense");
  const merchants = new Map<string, { merchant: string; merchant_key: string; amount: number; count: number }>();
  for (const row of rows) {
    if (!row.merchant.trim()) continue;
    const current = merchants.get(row.merchant_key) ?? {
      merchant: row.merchant,
      merchant_key: row.merchant_key,
      amount: 0,
      count: 0,
    };
    current.amount += signedExpense(row);
    current.count++;
    merchants.set(row.merchant_key, current);
  }
  return {
    rows: [...merchants.values()]
      .sort((a, b) => b.amount - a.amount || a.merchant.localeCompare(b.merchant))
      .slice(0, limit),
  };
}

export function statsAssets(db: Database, range: Range) {
  const rows = loadRows(db, range);
  const sums = new Map<string, { income: number; expense: number }>();
  for (const row of rows) {
    if (!row.asset_id) continue;
    const current = sums.get(row.asset_id) ?? { income: 0, expense: 0 };
    if (row.type === "income") current.income += row.amount;
    else current.expense += signedExpense(row);
    sums.set(row.asset_id, current);
  }
  return {
    rows: db
      .query<{ id: string; name: string }, []>("SELECT id,name FROM assets ORDER BY sort,name")
      .all()
      .map((asset) => ({ asset_id: asset.id, name: asset.name, ...(sums.get(asset.id) ?? { income: 0, expense: 0 }) })),
  };
}

export function statsCalendar(db: Database, month: string, _startDay: number) {
  const bounds = { from: `${month}-01`, to: `${addMonths(month, 1)}-01` };
  const rows = loadRows(db, bounds);
  const dayCount = daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)));
  const days = Array.from({ length: dayCount }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, "0")}`;
    const selected = rows.filter((row) => dayFor(row.occurred_at) === date);
    return {
      date,
      income: selected.reduce((sum, row) => sum + (row.type === "income" ? row.amount : 0), 0),
      expense: selected.reduce((sum, row) => sum + (row.type === "expense" ? signedExpense(row) : 0), 0),
      count: selected.length,
    };
  });
  return { month, range: bounds, days };
}
