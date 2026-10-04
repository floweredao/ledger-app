import type { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { nowKst } from "../../shared/dates";
import {
  AssetSchema,
  CategorySchema,
  RecurringRuleSchema,
  SettingsSchema,
  TemplateSchema,
  TransactionSchema,
} from "../../shared/schema";
import { ApiError } from "../http";

const tables = [
  "assets",
  "categories",
  "transactions",
  "merchant_rules",
  "budgets",
  "recurring_rules",
  "templates",
  "settings",
] as const;
const rowSchema = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));
type Row = z.infer<typeof rowSchema>;
const backupSchema = z
  .object({
    version: z.literal(1),
    exported_at: z.string(),
    tables: z
      .object({
        assets: z.array(rowSchema),
        categories: z.array(rowSchema),
        transactions: z.array(rowSchema),
        merchant_rules: z.array(rowSchema),
        budgets: z.array(rowSchema),
        recurring_rules: z.array(rowSchema),
        templates: z.array(rowSchema),
        settings: z.array(rowSchema),
      })
      .strict(),
  })
  .strict();
export type BackupExport = z.infer<typeof backupSchema>;

export function exportBackup(db: Database): BackupExport {
  return backupSchema.parse({
    version: 1,
    exported_at: nowKst(),
    tables: Object.fromEntries(tables.map((table) => [table, db.query<Row, []>("SELECT * FROM " + table).all()])),
  });
}

export function createPreRestoreSnapshot(db: Database, dataDir: string): void {
  const directory = join(dataDir, "backups");
  mkdirSync(directory, { recursive: true });
  db.query("VACUUM INTO ?").run(join(directory, "pre-restore-" + Bun.randomUUIDv7() + ".sqlite"));
}

export function restoreBackup(db: Database, input: unknown, dataDir: string): void {
  const parsed = backupSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, "invalid_request", "Invalid backup structure or version");
  const backup = parsed.data;
  const metadata = tables.map((table) => ({
    table,
    columns: db
      .query<{ name: string; type: string; notnull: number; pk: number }, []>("PRAGMA table_info(" + table + ")")
      .all(),
  }));
  try {
    for (const { table, columns } of metadata) {
      for (const row of backup.tables[table]) {
        // Version 1 exports made before the opening-date migration lack only this nullable column.
        if (table === "assets" && !Object.hasOwn(row, "opening_date")) row.opening_date = null;
        if (Object.keys(row).length !== columns.length) throw new Error("Unexpected backup columns");
        for (const column of columns) {
          if (!Object.hasOwn(row, column.name)) throw new Error("Missing backup column");
          const value = row[column.name];
          if (value === null) {
            if (column.notnull || column.pk) throw new Error("Required backup value missing");
          } else if (column.type === "TEXT") {
            if (typeof value !== "string") throw new Error("Invalid backup text");
          } else {
            if (typeof value !== "number") throw new Error("Invalid backup number");
            if (column.type === "INTEGER" && column.name !== "src_amount" && !Number.isSafeInteger(value)) {
              throw new Error("Invalid backup integer");
            }
          }
          if (["hidden", "is_refund", "active"].includes(column.name) && value !== 0 && value !== 1) {
            throw new Error("Invalid backup flag");
          }
        }
        if (table === "assets") AssetSchema.parse({ ...row, hidden: row.hidden === 1 });
        if (table === "categories") CategorySchema.parse({ ...row, hidden: row.hidden === 1 });
        if (table === "transactions")
          TransactionSchema.parse({
            ...row,
            hidden: row.hidden === 1,
            is_refund: row.is_refund === 1,
            user_locked: JSON.parse(z.string().parse(row.user_locked)),
          });
        if (table === "recurring_rules") {
          const rule = RecurringRuleSchema.parse({
            ...row,
            active: row.active === 1,
            template: JSON.parse(z.string().parse(row.template)),
          });
          if (rule.template.amount === undefined) throw new Error("Recurring amount missing");
        }
        if (table === "templates") TemplateSchema.parse({ ...row, payload: JSON.parse(z.string().parse(row.payload)) });
        if (table === "budgets" && (typeof row.amount !== "number" || row.amount < 0))
          throw new Error("Invalid budget");
      }
    }
    SettingsSchema.parse(
      Object.fromEntries(
        backup.tables.settings.map((row) => [z.string().parse(row.key), JSON.parse(z.string().parse(row.value))]),
      ),
    );
  } catch {
    throw new ApiError(400, "invalid_request", "Invalid backup rows");
  }
  createPreRestoreSnapshot(db, dataDir);
  try {
    db.transaction(() => {
      db.exec("PRAGMA defer_foreign_keys = ON");
      for (const table of tables) db.exec("DELETE FROM " + table);
      for (const { table, columns } of metadata) {
        const names = columns.map((column) => column.name);
        const statement = db.query(
          "INSERT INTO " + table + "(" + names.join(",") + ") VALUES(" + names.map(() => "?").join(",") + ")",
        );
        for (const row of backup.tables[table]) statement.run(...names.map((name) => row[name] ?? null));
      }
      db.exec("DELETE FROM idempotency; DELETE FROM import_state");
    }).immediate();
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string" &&
      error.code.startsWith("SQLITE_CONSTRAINT")
    ) {
      throw new ApiError(400, "invalid_request", "Backup references or values are invalid");
    }
    throw error;
  }
}
