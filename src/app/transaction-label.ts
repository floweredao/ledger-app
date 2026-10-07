import type { Category, Transaction } from "../../shared/schema";

export const TRANSFER_ICON = "arrow-left-right";

/** Row title: merchant first; transfers never carry a category, so they read as "이체" rather than "분류 없음". */
export function transactionTitle(transaction: Transaction, categoryName: string | undefined): string {
  if (transaction.merchant.trim()) return transaction.merchant;
  if (transaction.type === "transfer") return "이체";
  return categoryName ?? "분류 없음";
}

type CategoryLookup = (id: string) => Pick<Category, "name" | "parent_id"> | undefined;

/** "상위 › 하위" for a child category, the name alone for a top-level one; undefined when uncategorized or unknown. */
export function categoryPath(categoryId: string | null | undefined, lookup: CategoryLookup): string | undefined {
  const category = categoryId ? lookup(categoryId) : undefined;
  if (!category) return undefined;
  const parent = category.parent_id ? lookup(category.parent_id) : undefined;
  return parent ? `${parent.name} › ${category.name}` : category.name;
}

/** The category path for a row's secondary line, skipped when the title already reads as that category. */
export function rowCategoryLabel(
  categoryId: string | null | undefined,
  lookup: CategoryLookup,
  title: string,
): string | undefined {
  const path = categoryPath(categoryId, lookup);
  return path === title ? undefined : path;
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
