import type { TransactionType } from "./schema";

/** Product languages that format money; matches the client's i18n `Locale`. */
export type MoneyLocale = "ko" | "en";

const grouping: Record<MoneyLocale, Intl.NumberFormat> = {
  ko: new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }),
  en: new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }),
};
const wonEn = new Intl.NumberFormat("en-US", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });
const compactEn = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const oneDecimal = (n: number) => String(Math.round(n * 10) / 10);

/** Korean `12,345원`, English `₩12,345`. */
export function formatWon(amount: number, locale: MoneyLocale = "ko"): string {
  return locale === "ko" ? `${grouping.ko.format(amount)}원` : wonEn.format(amount);
}

/** Signed by direction: expense `-12,345원`, income or refund `+12,345원`, transfer unsigned. */
export function formatSigned(
  type: TransactionType,
  amount: number,
  isRefund = false,
  locale: MoneyLocale = "ko",
): string {
  switch (type) {
    case "expense":
      return `${(amount < 0) !== isRefund ? "+" : "-"}${formatWon(Math.abs(amount), locale)}`;
    case "income":
      return `${amount < 0 ? "-" : "+"}${formatWon(Math.abs(amount), locale)}`;
    case "transfer":
      return formatWon(amount, locale);
    default: {
      const unreachable: never = type;
      throw new RangeError(`Unknown transaction type: ${String(unreachable)}`);
    }
  }
}

/** Short units for tight cells: Korean `9,500`, `1.2만`, `350만`, `1.2억`; English `9,500`, `12K`, `3.5M`. */
export function compactWon(amount: number, locale: MoneyLocale = "ko"): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (abs < 10_000) return `${sign}${grouping[locale].format(abs)}`;
  if (locale === "en") return `${sign}${compactEn.format(abs)}`;
  if (abs < 100_000) return `${sign}${oneDecimal(abs / 10_000)}만`;
  const man = Math.round(abs / 10_000);
  if (man < 10_000) return `${sign}${grouping.ko.format(man)}만`;
  return `${sign}${oneDecimal(abs / 100_000_000)}억`;
}
