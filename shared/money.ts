import type { TransactionType } from "./schema";

const grouping = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const oneDecimal = (n: number) => String(Math.round(n * 10) / 10);

export function formatWon(amount: number): string {
  return `${grouping.format(amount)}원`;
}

/** Signed by direction: expense `-12,345원`, income or refund `+12,345원`, transfer unsigned. */
export function formatSigned(type: TransactionType, amount: number, isRefund = false): string {
  switch (type) {
    case "expense":
      return `${(amount < 0) !== isRefund ? "+" : "-"}${formatWon(Math.abs(amount))}`;
    case "income":
      return `${amount < 0 ? "-" : "+"}${formatWon(Math.abs(amount))}`;
    case "transfer":
      return formatWon(amount);
    default: {
      const unreachable: never = type;
      throw new RangeError(`Unknown transaction type: ${String(unreachable)}`);
    }
  }
}

/** Short Korean units for tight cells: `9,500`, `1.2만`, `350만`, `1.2억`. */
export function compactWon(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (abs < 10_000) return `${sign}${grouping.format(abs)}`;
  if (abs < 100_000) return `${sign}${oneDecimal(abs / 10_000)}만`;
  if (abs < 100_000_000) return `${sign}${grouping.format(Math.round(abs / 10_000))}만`;
  return `${sign}${oneDecimal(abs / 100_000_000)}억`;
}
