import type { Transaction } from "../../shared/schema";

export const TRANSFER_ICON = "arrow-left-right";

/** Row title: merchant first; transfers never carry a category, so they read as "이체" rather than "분류 없음". */
export function transactionTitle(transaction: Transaction, categoryName: string | undefined): string {
  if (transaction.merchant.trim()) return transaction.merchant;
  if (transaction.type === "transfer") return "이체";
  return categoryName ?? "분류 없음";
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
