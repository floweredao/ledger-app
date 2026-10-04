import type { Database } from "bun:sqlite";
import { addDays } from "../../shared/dates";
import type { Transaction, TransactionListQuery, TransactionPatch } from "../../shared/schema";
import { ApiError } from "../http";
import { getTransaction, insertTransaction, patchTransaction, restore, softDelete } from "./tx-core";

type Bindable = string | number;
type Where = { sql: string[]; values: Bindable[] };

function buildFilters(db: Database, query: TransactionListQuery): Where {
  const sql = ["deleted_at IS NULL"];
  const values: Bindable[] = [];
  if (query.from) {
    sql.push("occurred_at >= ?");
    values.push(`${query.from}T00:00:00+09:00`);
  }
  if (query.to) {
    sql.push("occurred_at < ?");
    values.push(`${addDays(query.to, 1)}T00:00:00+09:00`);
  }
  if (query.q) {
    sql.push("(instr(lower(merchant), lower(?)) > 0 OR instr(lower(memo), lower(?)) > 0)");
    values.push(query.q, query.q);
  }
  if (query.type) {
    sql.push("type = ?");
    values.push(query.type);
  }
  if (query.category_id === "uncategorized") {
    sql.push("category_id IS NULL");
  } else if (query.category_id) {
    const ids = db
      .query<{ id: string }, [string]>(
        `WITH RECURSIVE descendants(id) AS (
					SELECT id FROM categories WHERE id=?
					UNION ALL SELECT c.id FROM categories c JOIN descendants d ON c.parent_id=d.id
				) SELECT id FROM descendants`,
      )
      .all(query.category_id)
      .map(({ id }) => id);
    if (ids.length === 0) sql.push("category_id = ?");
    else sql.push(`category_id IN (${ids.map(() => "?").join(",")})`);
    values.push(...(ids.length === 0 ? [query.category_id] : ids));
  }
  if (query.asset_id) {
    const relatedAssets = db
      .query<{ id: string }, [string]>("SELECT id FROM assets WHERE linked_asset_id=? AND kind='check_card'")
      .all(query.asset_id)
      .map(({ id }) => id);
    const ids = [query.asset_id, ...relatedAssets];
    sql.push(`(asset_id IN (${ids.map(() => "?").join(",")}) OR to_asset_id IN (${ids.map(() => "?").join(",")}))`);
    values.push(...ids, ...ids);
  }
  if (query.min !== undefined) {
    sql.push("amount >= ?");
    values.push(query.min);
  }
  if (query.max !== undefined) {
    sql.push("amount <= ?");
    values.push(query.max);
  }
  if (query.source) {
    sql.push("source = ?");
    values.push(query.source);
  }
  if (query.hidden === "exclude") sql.push("hidden = 0");
  if (query.hidden === "only") sql.push("hidden = 1");
  return { sql, values };
}

function decodeCursor(cursor: string): { occurred_at: string; id: string } {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      typeof value === "object" &&
      value !== null &&
      "occurred_at" in value &&
      typeof value.occurred_at === "string" &&
      "id" in value &&
      typeof value.id === "string"
    ) {
      return { occurred_at: value.occurred_at, id: value.id };
    }
  } catch {}
  throw new ApiError(400, "invalid_cursor", "Invalid transaction cursor");
}

export function listTransactions(db: Database, query: TransactionListQuery) {
  const filters = buildFilters(db, query);
  const where = filters.sql.join(" AND ");
  const countRow = db
    .query<{ count: number; income: number; expense: number }, Bindable[]>(
      `SELECT COUNT(*) AS count,
				COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) AS income,
				COALESCE(SUM(CASE WHEN type='expense' THEN amount * CASE WHEN is_refund=1 THEN -1 ELSE 1 END ELSE 0 END),0) AS expense
			 FROM transactions WHERE ${where}`,
    )
    .get(...filters.values);
  let pageSql = where;
  const pageValues = [...filters.values];
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    pageSql += " AND (occurred_at < ? OR (occurred_at = ? AND id < ?))";
    pageValues.push(cursor.occurred_at, cursor.occurred_at, cursor.id);
  }
  const rows = db
    .query<{ id: string }, Bindable[]>(
      `SELECT id FROM transactions WHERE ${pageSql} ORDER BY occurred_at DESC, id DESC LIMIT ?`,
    )
    .all(...pageValues, query.limit + 1);
  const hasMore = rows.length > query.limit;
  const items = rows
    .slice(0, query.limit)
    .map(({ id }) => getTransaction(db, id))
    .filter((item): item is Transaction => item !== null);
  const last = items.at(-1);
  const nextCursor =
    hasMore && last
      ? Buffer.from(JSON.stringify({ occurred_at: last.occurred_at, id: last.id })).toString("base64url")
      : null;
  return {
    items,
    totals: {
      income: countRow?.income ?? 0,
      expense: countRow?.expense ?? 0,
      net: (countRow?.income ?? 0) - (countRow?.expense ?? 0),
      count: countRow?.count ?? 0,
    },
    next_cursor: nextCursor,
  };
}

export function createTransaction(db: Database, input: Parameters<typeof insertTransaction>[1]) {
  if (input.category_id) {
    const category = db
      .query<{ type: string }, [string]>("SELECT type FROM categories WHERE id=?")
      .get(input.category_id);
    if (!category || (input.type !== "transfer" && category.type !== input.type)) {
      throw new ApiError(400, "invalid_category", "Category does not match transaction type");
    }
  }
  for (const assetId of [input.asset_id, input.to_asset_id]) {
    if (assetId !== undefined && assetId !== null && !db.query("SELECT 1 FROM assets WHERE id=?").get(assetId)) {
      throw new ApiError(400, "invalid_asset", "Asset not found");
    }
  }
  try {
    return insertTransaction(db, input);
  } catch (error) {
    if (error instanceof Error && error.message.includes("FOREIGN KEY")) {
      throw new ApiError(400, "invalid_reference", "Transaction reference is invalid");
    }
    throw error;
  }
}

export function updateTransaction(db: Database, id: string, patch: TransactionPatch) {
  const { learn, apply_to_past: applyToPast, ...fields } = patch;
  const current = getTransaction(db, id);
  if (!current) throw new ApiError(404, "not_found", "Transaction not found");
  const targetType = fields.type ?? current.type;
  const categoryId = fields.category_id === undefined ? current.category_id : fields.category_id;
  if (categoryId) {
    const category = db.query<{ type: string }, [string]>("SELECT type FROM categories WHERE id=?").get(categoryId);
    if (!category || (targetType !== "transfer" && category.type !== targetType)) {
      throw new ApiError(400, "invalid_category", "Category does not match transaction type");
    }
  }
  for (const assetId of [fields.asset_id, fields.to_asset_id]) {
    if (assetId !== undefined && assetId !== null && !db.query("SELECT 1 FROM assets WHERE id=?").get(assetId)) {
      throw new ApiError(400, "invalid_asset", "Asset not found");
    }
  }
  const { transaction, changed } = patchTransaction(db, id, fields);
  let appliedCount = 0;
  if (
    changed.includes("category_id") &&
    transaction.category_id !== null &&
    learn !== false &&
    transaction.merchant_key !== ""
  ) {
    const now = transaction.updated_at;
    db.query(
      `INSERT INTO merchant_rules(merchant_key,category_id,type,updated_at) VALUES(?,?,?,?)
			 ON CONFLICT(merchant_key,type) DO UPDATE SET category_id=excluded.category_id,updated_at=excluded.updated_at`,
    ).run(transaction.merchant_key, transaction.category_id, transaction.type, now);
    if (applyToPast === true && transaction.category_id !== null) {
      const result = db
        .query(
          `UPDATE transactions SET category_id=?,updated_at=?
					 WHERE id<>? AND merchant_key=? AND type=? AND deleted_at IS NULL
					 AND instr(user_locked, '"category_id"')=0`,
        )
        .run(transaction.category_id, now, transaction.id, transaction.merchant_key, transaction.type);
      appliedCount = Number(result.changes);
    }
  }
  return { transaction, applied_count: appliedCount };
}

export function deleteTransaction(db: Database, id: string) {
  return softDelete(db, id);
}

export function restoreTransaction(db: Database, id: string) {
  return restore(db, id);
}
