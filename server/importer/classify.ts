import type { Database } from "bun:sqlite";
import { matchRule, merchantKey } from "../../shared/merchant";
import type { TransactionType } from "../../shared/schema";
import { merchantDictionary } from "./merchant-dictionary";
import { type Entry, EntrySchema } from "./source";

export function categoryId(db: Database, type: string, parent: string, child?: string): string | null {
  if (child) {
    return (
      db
        .query<{ id: string }, [string, string, string]>(
          `SELECT c.id FROM categories c JOIN categories p ON c.parent_id=p.id
       WHERE c.type=? AND p.name=? AND c.name=?`,
        )
        .get(type, parent, child)?.id ?? null
    );
  }
  return (
    db
      .query<{ id: string }, [string, string]>(
        "SELECT id FROM categories WHERE type=? AND name=? AND parent_id IS NULL",
      )
      .get(type, parent)?.id ?? null
  );
}

export function classify(db: Database, entry: Entry, type: TransactionType, merchant: string): string | null {
  const rules = db
    .query<{ merchant_key: string; category_id: string }, [string]>(
      "SELECT merchant_key,category_id FROM merchant_rules WHERE type=? ORDER BY merchant_key",
    )
    .all(type);
  const key = matchRule(
    merchantKey(merchant),
    rules.map((rule) => rule.merchant_key),
  );
  if (key) return rules.find((rule) => rule.merchant_key === key)?.category_id ?? null;
  if (type === "transfer") return null;
  if (type === "expense") {
    for (const [pattern, parent, child] of merchantDictionary) {
      if (pattern.test(merchant)) return categoryId(db, type, parent, child);
    }
    if (/수수료/.test(entry.kind)) return categoryId(db, type, "금융", "수수료");
    if (/이체/.test(entry.kind)) return categoryId(db, type, "이체·송금");
  } else {
    if (/이자/.test(entry.kind)) return categoryId(db, type, "이자");
    if (/캐시백|환급/.test(entry.kind)) return categoryId(db, type, "캐시백·환급");
    if (/입금/.test(entry.kind)) return categoryId(db, type, "이체입금");
  }
  return categoryId(db, type, "미분류");
}

/** Refund matching reads immutable source identity, but inherits the owner's current category. */
export function refundCategory(db: Database, entry: Entry): { readonly category_id: string | null } | null {
  const key = merchantKey(entry.counterparty.replace(/취소|환불/g, ""));
  const originals = db
    .query<
      {
        source_raw: string;
        category_id: string | null;
        type: TransactionType;
      },
      [string]
    >(
      `SELECT source_raw,category_id,type FROM transactions
     WHERE src_account=? AND source IN ('kakaobank_sms','kakaobank_excel')
     ORDER BY src_at DESC,id`,
    )
    .all(entry.account);
  for (const row of originals) {
    const original = EntrySchema.parse(JSON.parse(row.source_raw));
    if (Date.parse(original.at) > Date.parse(entry.at) || original.amount >= 0) continue;
    if (/취소|환불/.test(`${original.kind} ${original.counterparty}`)) continue;
    if (Math.abs(original.amount) !== Math.abs(entry.amount)) continue;
    if (merchantKey(original.counterparty.replace(/취소|환불/g, "")) !== key) continue;
    return { category_id: row.type === "transfer" ? categoryId(db, "expense", "이체·송금") : row.category_id };
  }
  return null;
}
