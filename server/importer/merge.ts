import type { Database } from "bun:sqlite";
import { nowKst } from "../../shared/dates";
import { type TransactionPatch, TransactionPatchSchema } from "../../shared/schema";
import { getTransaction, patchTransaction } from "../domain/tx-core";
import type { MappedEntry } from "./map";
import { type Entry, EntrySchema, sourceKey } from "./source";

/** Use tx-core validation and merchant-key handling without turning automatic updates into owner locks. */
export function patchUnlocked(db: Database, id: string, patch: TransactionPatch): boolean {
  const current = getTransaction(db, id);
  if (!current) return false;
  const unlocked = TransactionPatchSchema.parse(
    Object.fromEntries(Object.entries(patch).filter(([field]) => !current.user_locked.includes(field))),
  );
  const result = patchTransaction(db, id, unlocked);
  if (result.changed.length === 0) return false;
  db.query("UPDATE transactions SET user_locked=? WHERE id=?").run(JSON.stringify(current.user_locked), id);
  return true;
}

export function duplicate(db: Database, entry: Entry): boolean {
  if (db.query("SELECT 1 FROM transactions WHERE source_key=?").get(sourceKey(entry))) return true;
  if (entry.source === "excel") return false;
  const candidates = db
    .query<{ src_at: string; source_raw: string }, [string, number]>(
      `SELECT src_at,source_raw FROM transactions WHERE src_account=? AND src_amount=?
     AND source IN ('kakaobank_sms','kakaobank_excel')`,
    )
    .all(entry.account, entry.amount);
  return candidates.some(
    (row) =>
      Math.floor(Date.parse(row.src_at) / 60000) === Math.floor(Date.parse(entry.at) / 60000) &&
      EntrySchema.parse(JSON.parse(row.source_raw)).balance === entry.balance,
  );
}

export function mergeExcel(db: Database, entry: Entry, mapped: MappedEntry): boolean {
  if (entry.source !== "excel") return false;
  const candidates = db
    .query<{ id: string; src_at: string; src_amount: number; source_raw: string }, [string]>(
      "SELECT id,src_at,src_amount,source_raw FROM transactions WHERE source='kakaobank_sms' AND src_account=?",
    )
    .all(entry.account)
    .filter((row) => Math.abs(Date.parse(row.src_at) - Date.parse(entry.at)) <= 600000);
  candidates.sort(
    (a, b) =>
      Math.abs(Date.parse(a.src_at) - Date.parse(entry.at)) - Math.abs(Date.parse(b.src_at) - Date.parse(entry.at)) ||
      a.id.localeCompare(b.id),
  );
  const match =
    (entry.balance === null
      ? undefined
      : candidates.find((row) => EntrySchema.parse(JSON.parse(row.source_raw)).balance === entry.balance)) ??
    candidates.find((row) => row.src_amount === entry.amount);
  if (!match) return false;
  const current = getTransaction(db, match.id);
  if (!current) return false;
  const { memo: _memo, id: _id, ...fields } = mapped.input;
  const foreign = current.currency !== "KRW" && current.foreign_amount !== null;
  patchUnlocked(db, match.id, {
    ...fields,
    ...(foreign ? { currency: current.currency, foreign_amount: current.foreign_amount, krw_status: "exact" } : {}),
    hidden: mapped.options.hidden,
    hidden_reason: mapped.options.hidden_reason,
  });
  db.query(
    `UPDATE transactions SET source='kakaobank_excel',source_key=?,source_raw=?,src_account=?,src_amount=?,src_at=?,updated_at=?
     WHERE id=?`,
  ).run(sourceKey(entry), JSON.stringify(entry), entry.account, entry.amount, entry.at, nowKst(), match.id);
  return true;
}
