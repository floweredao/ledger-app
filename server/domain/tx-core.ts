import type { Database } from "bun:sqlite";
import { z } from "zod";
import { nowKst, toKstIso } from "../../shared/dates";
import { merchantKey } from "../../shared/merchant";
import {
  type Source,
  type SourceDetail,
  type Transaction,
  type TransactionInput,
  type TransactionPatch,
  TransactionSchema,
} from "../../shared/schema";
import { ApiError } from "../http";

/** Importer/recurring-only columns; the API never accepts them and patchTransaction never writes them. */
export type InsertOptions = {
  readonly source?: Source;
  readonly source_key?: string | null;
  readonly source_raw?: string | null;
  readonly src_account?: string | null;
  readonly src_amount?: number | null;
  readonly src_at?: string | null;
  readonly hidden?: boolean;
  readonly hidden_reason?: string | null;
  readonly recurring_rule_id?: string | null;
  readonly now?: string;
};
export type EditableField = Exclude<keyof TransactionPatch, "learn" | "apply_to_past">;
export type PatchResult = { readonly transaction: Transaction; readonly changed: readonly EditableField[] };

type Bindable = string | number | null;
const EDITABLE_FIELDS = [
  "type",
  "occurred_at",
  "amount",
  "is_refund",
  "currency",
  "foreign_amount",
  "krw_status",
  "asset_id",
  "to_asset_id",
  "category_id",
  "merchant",
  "memo",
  "hidden",
  "hidden_reason",
] as const satisfies readonly EditableField[];

const flag = z.number().transform((value) => value === 1);
const ImportedEntrySchema = z.object({
  kind: z.string(),
  counterparty: z.string(),
  account: z.string(),
  amount: z.number(),
  balance: z.number().nullable(),
  currency: z.string().optional(),
  at: z.string(),
});
const IMPORTED_SOURCES: ReadonlySet<Source> = new Set(["kakaobank_sms", "kakaobank_excel"]);

/** The importer's own entry (source_raw) for bank-imported rows; owner edits never touch it. */
function sourceDetail(source: Source, raw: string | null): SourceDetail | null {
  if (raw === null || !IMPORTED_SOURCES.has(source)) return null;
  const entry = ImportedEntrySchema.parse(JSON.parse(raw));
  return { ...entry, currency: entry.currency ?? null };
}

const TransactionRowSchema = TransactionSchema.extend({
  is_refund: flag,
  hidden: flag,
  user_locked: z.string().transform((value) => z.array(z.string()).parse(JSON.parse(value))),
  source_raw: z.string().nullable(),
}).transform(
  ({ source_raw, ...row }): Transaction => ({ ...row, source_detail: sourceDetail(row.source, source_raw) }),
);
const toColumn = (value: string | number | boolean | null): Bindable =>
  typeof value === "boolean" ? Number(value) : value;

export function getTransaction(db: Database, id: string): Transaction | null {
  const row = db.query("SELECT * FROM transactions WHERE id=?").get(id);
  return row ? TransactionRowSchema.parse(row) : null;
}

function requireTransaction(db: Database, id: string): Transaction {
  const transaction = getTransaction(db, id);
  if (!transaction) throw new ApiError(404, "not_found", "Transaction not found");
  return transaction;
}

/** settings.default_asset_id when it still exists, else the seeded 현금 asset. */
export function defaultAssetId(db: Database): string | null {
  const setting = db.query<{ value: string }, []>("SELECT value FROM settings WHERE key='default_asset_id'").get();
  const configured = setting ? z.string().nullable().parse(JSON.parse(setting.value)) : null;
  if (configured && db.query("SELECT 1 FROM assets WHERE id=?").get(configured)) return configured;
  const cash = db
    .query<{ id: string }, []>("SELECT id FROM assets WHERE kind='cash' ORDER BY name='현금' DESC, created_at LIMIT 1")
    .get();
  return cash?.id ?? null;
}

function assertTransfer(type: string, assetId: string | null, toAssetId: string | null): void {
  if (type === "transfer" && (toAssetId === null || toAssetId === assetId)) {
    throw new ApiError(400, "invalid_transfer", "A transfer needs a different to_asset_id");
  }
}

export function insertTransaction(db: Database, input: TransactionInput, options: InsertOptions = {}): Transaction {
  const id = input.id ?? Bun.randomUUIDv7();
  if (input.id !== undefined && db.query("SELECT 1 FROM transactions WHERE id=?").get(id)) {
    throw new ApiError(409, "conflict", "Transaction id already exists");
  }
  const assetId = input.asset_id === undefined ? defaultAssetId(db) : input.asset_id;
  const toAssetId = input.to_asset_id ?? null;
  assertTransfer(input.type, assetId, toAssetId);
  const now = options.now ?? nowKst();
  db.query(
    `INSERT INTO transactions(id,type,occurred_at,amount,is_refund,currency,foreign_amount,krw_status,asset_id,to_asset_id,
      category_id,merchant,merchant_key,memo,source,source_key,source_raw,src_account,src_amount,src_at,hidden,hidden_reason,
      user_locked,recurring_rule_id,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'[]',?,?,?)`,
  ).run(
    id,
    input.type,
    toKstIso(new Date(input.occurred_at)),
    input.amount,
    Number(input.is_refund),
    input.currency,
    input.foreign_amount ?? null,
    input.krw_status,
    assetId,
    toAssetId,
    input.category_id ?? null,
    input.merchant,
    merchantKey(input.merchant),
    input.memo,
    options.source ?? "manual",
    options.source_key ?? null,
    options.source_raw ?? null,
    options.src_account ?? null,
    options.src_amount ?? null,
    options.src_at ?? null,
    Number(options.hidden ?? false),
    options.hidden_reason ?? null,
    options.recurring_rule_id ?? null,
    now,
    now,
  );
  return requireTransaction(db, id);
}

/** Applies the editable fields that actually change and records their names in user_locked. */
export function patchTransaction(db: Database, id: string, patch: TransactionPatch, now = nowKst()): PatchResult {
  const current = requireTransaction(db, id);
  const fields =
    patch.occurred_at === undefined ? patch : { ...patch, occurred_at: toKstIso(new Date(patch.occurred_at)) };
  const changed = EDITABLE_FIELDS.filter((field) => fields[field] !== undefined && fields[field] !== current[field]);
  if (changed.length === 0) return { transaction: current, changed };
  const next = { ...current, ...Object.fromEntries(changed.map((field) => [field, fields[field]])) };
  assertTransfer(next.type, next.asset_id, next.to_asset_id);
  const columns: [string, Bindable][] = changed.map((field) => [field, toColumn(next[field])]);
  if (changed.includes("merchant")) columns.push(["merchant_key", merchantKey(next.merchant)]);
  const locked = [...new Set([...current.user_locked, ...changed])];
  columns.push(["user_locked", JSON.stringify(locked)], ["updated_at", now]);
  db.query(`UPDATE transactions SET ${columns.map(([column]) => `${column}=?`).join(",")} WHERE id=?`).run(
    ...columns.map(([, value]) => value),
    id,
  );
  return { transaction: requireTransaction(db, id), changed };
}

export function softDelete(db: Database, id: string, now = nowKst()): Transaction {
  requireTransaction(db, id);
  db.query("UPDATE transactions SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL").run(now, now, id);
  return requireTransaction(db, id);
}

export function restore(db: Database, id: string, now = nowKst()): Transaction {
  requireTransaction(db, id);
  db.query("UPDATE transactions SET deleted_at=NULL, updated_at=? WHERE id=? AND deleted_at IS NOT NULL").run(now, id);
  return requireTransaction(db, id);
}
