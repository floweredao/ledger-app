import { merchantKey } from "../../shared/merchant";
import type { Transaction } from "../../shared/schema";

export const TRANSFER_ICON = "arrow-left-right";

/** Row title: merchant first; transfers never carry a category, so they read as "이체" rather than "분류 없음". */
export function transactionTitle(transaction: Transaction, categoryName: string | undefined): string {
  if (transaction.merchant.trim()) return transaction.merchant;
  if (transaction.type === "transfer") return "이체";
  return categoryName ?? "분류 없음";
}

/** "원래: <bank wording>" once the owner renamed an imported record; undefined while the title still matches. */
export function originalNameLine(transaction: Transaction): string | undefined {
  // Same trimming the importer applies to build the first merchant (drops a cut-off "(…" tail).
  const counterparty = transaction.source_detail?.counterparty.replace(/\([^()]*$/, "").trim();
  if (!counterparty || merchantKey(counterparty) === merchantKey(transaction.merchant)) return undefined;
  return `원래: ${counterparty}`;
}

/** "보내는 자산 → 받는 자산" for transfers once both names are known; otherwise undefined. */
export function transferRoute(
  transaction: Transaction,
  assetName: (id: string) => string | undefined,
): string | undefined {
  if (transaction.type !== "transfer" || !transaction.asset_id || !transaction.to_asset_id) return undefined;
  const from = assetName(transaction.asset_id);
  const to = assetName(transaction.to_asset_id);
  return from && to ? `${from} → ${to}` : undefined;
}
