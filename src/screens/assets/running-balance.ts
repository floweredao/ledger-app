import { kstDate } from "../../../shared/dates";
import type { Transaction } from "../../../shared/schema";

type Flow = Pick<
  Transaction,
  "id" | "type" | "amount" | "is_refund" | "asset_id" | "to_asset_id" | "occurred_at" | "hidden"
>;

type Input = {
  /** The asset's balance now, as the summary computes it. */
  readonly balance: number;
  /** The balance account and the check cards booked on it. */
  readonly accountIds: ReadonlySet<string>;
  /** Records before this KST date are not part of the balance. */
  readonly openingDate: string | null;
  /** Newest first, as the transaction list returns them. */
  readonly items: readonly Flow[];
};

/** How a record moved the balance; the same rules as the server's asset summary. */
function delta(flow: Flow, accountIds: ReadonlySet<string>): number {
  const from = flow.asset_id !== null && accountIds.has(flow.asset_id);
  const to = flow.to_asset_id !== null && accountIds.has(flow.to_asset_id);
  if (flow.type === "income") return from ? flow.amount : 0;
  if (flow.type === "expense") return from ? (flow.is_refund ? flow.amount : -flow.amount) : 0;
  return (to ? flow.amount : 0) - (from ? flow.amount : 0);
}

/** The balance right after each counted record, walking back from the current balance. */
export function runningBalances({ balance, accountIds, openingDate, items }: Input): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  let after = balance;
  for (const item of items) {
    if (item.hidden || (openingDate !== null && kstDate(item.occurred_at) < openingDate)) continue;
    result.set(item.id, after);
    after -= delta(item, accountIds);
  }
  return result;
}
