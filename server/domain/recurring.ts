import type { Database } from "bun:sqlite";
import { addDays, daysInMonth, kstDate, nowKst } from "../../shared/dates";
import {
  type RecurringInput,
  type TemplatePayload,
  TemplatePayloadSchema,
  TransactionInputSchema,
} from "../../shared/schema";
import { ApiError } from "../http";
import { insertTransaction } from "./tx-core";

type Frequency = RecurringInput["freq"];
type Rule = {
  id: string;
  template: string;
  freq: Frequency;
  interval: number;
  start_date: string;
  end_date: string | null;
  last_materialized_date: string | null;
};

export function validateTemplateReferences(db: Database, payload: TemplatePayload): void {
  for (const assetId of [payload.asset_id, payload.to_asset_id]) {
    if (assetId != null && !db.query("SELECT 1 FROM assets WHERE id=?").get(assetId)) {
      throw new ApiError(400, "invalid_asset", "Template asset does not exist");
    }
  }
  if (payload.category_id != null && !db.query("SELECT 1 FROM categories WHERE id=?").get(payload.category_id)) {
    throw new ApiError(400, "invalid_category", "Template category does not exist");
  }
}

function dateParts(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) throw new RangeError(`Invalid date: ${value}`);
  return { year, month, day };
}

function occurrenceDate(start: string, frequency: Frequency, interval: number, index: number): string {
  const { year, month, day } = dateParts(start);
  const steps = index * interval;
  if (frequency === "daily") return addDays(start, steps);
  if (frequency === "weekly") return addDays(start, steps * 7);
  if (frequency === "monthly") {
    const monthIndex = year * 12 + month - 1 + steps;
    const targetYear = Math.floor(monthIndex / 12);
    const targetMonth = (monthIndex % 12) + 1;
    return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(Math.min(day, daysInMonth(targetYear, targetMonth))).padStart(2, "0")}`;
  }
  const targetYear = year + steps;
  return `${targetYear}-${String(month).padStart(2, "0")}-${String(Math.min(day, daysInMonth(targetYear, month))).padStart(2, "0")}`;
}

/** Insert every due occurrence transactionally; source_key makes retries safe even after partial history. */
export function materialize(db: Database, today = kstDate()): number {
  const run = db.transaction(() => {
    let created = 0;
    const rules = db
      .query<Rule, []>(
        "SELECT id,template,freq,interval,start_date,end_date,last_materialized_date FROM recurring_rules WHERE active=1",
      )
      .all();
    const now = nowKst();
    for (const rule of rules) {
      const template = TemplatePayloadSchema.parse(JSON.parse(rule.template));
      const first = rule.last_materialized_date ? addDays(rule.last_materialized_date, 1) : rule.start_date;
      if (first > today || (rule.end_date !== null && first > rule.end_date)) continue;
      const elapsed = rule.last_materialized_date
        ? Math.max(
            0,
            Math.floor((Date.parse(`${first}T00:00:00Z`) - Date.parse(`${rule.start_date}T00:00:00Z`)) / 86_400_000),
          )
        : 0;
      let index = rule.last_materialized_date
        ? Math.ceil(elapsed / (rule.freq === "daily" ? rule.interval : rule.freq === "weekly" ? rule.interval * 7 : 1))
        : 0;
      if (rule.last_materialized_date && (rule.freq === "monthly" || rule.freq === "yearly")) {
        const { year: startYear, month: startMonth } = dateParts(rule.start_date);
        const { year: nextYear, month: nextMonth } = dateParts(first);
        const diff =
          rule.freq === "monthly" ? (nextYear - startYear) * 12 + nextMonth - startMonth : nextYear - startYear;
        index = Math.ceil(diff / rule.interval);
      }
      let latest = rule.last_materialized_date;
      for (;;) {
        const due = occurrenceDate(rule.start_date, rule.freq, rule.interval, index);
        if (due > today || (rule.end_date !== null && due > rule.end_date)) break;
        const transactionInput = TransactionInputSchema.parse({
          ...template,
          occurred_at: `${due}T00:00:00+09:00`,
        });
        const sourceKey = `rec:${rule.id}:${due}`;
        if (!db.query("SELECT 1 FROM transactions WHERE source_key=?").get(sourceKey)) {
          insertTransaction(db, transactionInput, {
            source: "recurring",
            source_key: sourceKey,
            recurring_rule_id: rule.id,
            now,
          });
          created += 1;
        }
        latest = due;
        index += 1;
      }
      if (latest !== rule.last_materialized_date) {
        db.query("UPDATE recurring_rules SET last_materialized_date=?,updated_at=? WHERE id=?").run(
          latest,
          now,
          rule.id,
        );
      }
    }
    return created;
  });
  return run.immediate();
}
