import type { TransactionType } from "../../shared/schema";
import { useMessages } from "../i18n";
import { common } from "../i18n/common";
import { formatSigned, formatWon } from "../i18n/format";

type Kind = "expense" | "income" | "refund" | "transfer";

type Props = {
  readonly type: TransactionType;
  readonly amount: number;
  readonly isRefund?: boolean;
  readonly size?: "sm" | "md" | "lg";
  readonly className?: string;
};

export function AmountText({ type, amount, isRefund = false, size = "md", className }: Props) {
  const c = useMessages(common);
  const kind: Kind = type === "expense" && isRefund ? "refund" : type;
  return (
    <span className={["amount", "num", `amount-${size}`, className ?? ""].join(" ").trim()} data-kind={kind}>
      <span aria-hidden="true">{formatSigned(type, amount, isRefund)}</span>
      <span className="sr-only">
        {c[kind]} {formatWon(amount)}
      </span>
    </span>
  );
}
