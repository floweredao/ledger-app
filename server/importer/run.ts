import type { Database } from "bun:sqlite";
import { nowKst } from "../../shared/dates";
import { insertTransaction } from "../domain/tx-core";
import { mapEntry } from "./map";
import { duplicate, mergeExcel, patchUnlocked } from "./merge";
import { EntrySchema, loadEntries } from "./source";

export type ImportResult = { inserted: number; merged: number; skipped: number; hidden: number; errors: string[] };
export type Importer = { run(): Promise<ImportResult>; reclassify(): number };

export function createImporter({ db, modulePath }: { db: Database; modulePath: string }): Importer {
  let active: Promise<ImportResult> | null = null;
  const record = (key: string, value: unknown) => {
    db.query("INSERT INTO import_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(
      key,
      JSON.stringify(value),
    );
  };
  const execute = async (): Promise<ImportResult> => {
    const result: ImportResult = { inserted: 0, merged: 0, skipped: 0, hidden: 0, errors: [] };
    try {
      const entries = await loadEntries(modulePath);
      db.transaction(() => {
        const balances = new Map<string, number>();
        for (const entry of entries) {
          const previous = balances.get(entry.account) ?? null;
          if (duplicate(db, entry)) {
            result.skipped++;
          } else {
            const mapped = mapEntry(db, entry, previous);
            if (mergeExcel(db, entry, mapped)) result.merged++;
            else {
              insertTransaction(db, mapped.input, mapped.options);
              result.inserted++;
            }
            if (mapped.options.hidden) result.hidden++;
          }
          if (entry.balance !== null) {
            balances.set(entry.account, entry.balance);
            const key = `reported:kakaobank:${entry.account}`;
            const prior = db.query<{ value: string }, [string]>("SELECT value FROM import_state WHERE key=?").get(key);
            const reported: { at: string } | null = prior ? JSON.parse(prior.value) : null;
            if (!reported || Date.parse(entry.at) >= Date.parse(reported.at)) {
              record(key, { balance: entry.balance, at: entry.at });
            }
          }
        }
        record("last_run_at", nowKst());
        record("last_result", result);
        record("last_error", null);
      }).immediate();
    } catch (error) {
      // Source modules may include private input in thrown errors. Only a fixed error code is persisted.
      if (!(error instanceof Error)) throw error;
      result.inserted = 0;
      result.merged = 0;
      result.skipped = 0;
      result.hidden = 0;
      result.errors.push("import_failed");
      record("last_run_at", nowKst());
      record("last_result", result);
      record("last_error", "import_failed");
    }
    return result;
  };
  return {
    run: () => {
      if (active) return active;
      active = execute().finally(() => {
        active = null;
      });
      return active;
    },
    reclassify: () =>
      db
        .transaction(() => {
          let changed = 0;
          const balances = new Map<string, number>();
          const rows = db
            .query<{ id: string; source_raw: string }, []>(
              "SELECT id,source_raw FROM transactions WHERE source IN ('kakaobank_excel','kakaobank_sms') ORDER BY src_at,id",
            )
            .all();
          for (const row of rows) {
            const entry = EntrySchema.parse(JSON.parse(row.source_raw));
            const mapped = mapEntry(db, entry, balances.get(entry.account) ?? null);
            const { type, asset_id, to_asset_id, category_id, is_refund } = mapped.input;
            if (patchUnlocked(db, row.id, { type, asset_id, to_asset_id, category_id, is_refund })) changed++;
            if (entry.balance !== null) balances.set(entry.account, entry.balance);
          }
          return changed;
        })
        .immediate(),
  };
}
