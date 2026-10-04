import { formatSigned, formatWon } from "../../shared/money";
import type { TransactionType } from "../../shared/schema";

type Kind = "expense" | "income" | "refund" | "transfer";
const LABEL: Record<Kind, string> = { expense: "지출", income: "수입", refund: "환불", transfer: "이체" };

type Props = {
  readonly type: TransactionType;
  readonly amount: number;
  readonly isRefund?: boolean;
  readonly size?: "sm" | "md" | "lg";
  readonly className?: string;
};

export function AmountText({ type, amount, isRefund = false, size = "md", className }: Props) {
  const kind: Kind = type === "expense" && isRefund ? "refund" : type;
  return (
    <span className={["amount", "num", `amount-${size}`, className ?? ""].join(" ").trim()} data-kind={kind}>
      <span aria-hidden="true">{formatSigned(type, amount, isRefund)}</span>
      <span className="sr-only">
        {LABEL[kind]} {formatWon(amount)}
      </span>
    </span>
  );
}
