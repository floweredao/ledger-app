import { useMessages } from "../../i18n";
import { ledgerMessages } from "./messages";
import "./daily.css";
import type { StatsTrend } from "../../../shared/schema";
import { paths } from "../../api/client";
import { useApi } from "../../api/hooks";
import { calendarYearFilter } from "../../app/periods";
import { EmptyState } from "../../components/EmptyState";
import { Skeleton } from "../../components/Skeleton";
import { formatDisplayDate, formatMonth, formatMonthShort, formatSigned } from "../../i18n/format";
import { Link, useSelectedYear } from "../../router";

type MonthTotal = { readonly month: string; readonly income: number; readonly expense: number; readonly net: number };

function monthsFor(year: string, buckets: StatsTrend["buckets"]): readonly MonthTotal[] {
  const totals = new Map(buckets.map((bucket) => [bucket.month, bucket]));
  return Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, "0")}`;
    const total = totals.get(month);
    return { month, income: total?.income ?? 0, expense: total?.expense ?? 0, net: total?.net ?? 0 };
  });
}

export default function MonthlyView() {
  const m = useMessages(ledgerMessages);

  const [year] = useSelectedYear();
  const range = calendarYearFilter(year);
  const trend = useApi<StatsTrend>(paths.statsTrend({ end: `${year}-12`, months: 12, basis: "calendar" }));
  const buckets = trend.data?.buckets;

  if (!buckets && trend.loading) return <Skeleton rows={6} label={m.loadingYear(year)} />;
  if (!buckets) {
    return <EmptyState tone="error" title={m.loadMonthlyFailed} description={m.tryLater} />;
  }

  return (
    <section className="monthly-view" aria-label={m.yearRecords(year)}>
      <div className="monthly-grid">
        {monthsFor(year, buckets).map((month) => {
          return (
            <Link
              key={month.month}
              to={`/?month=${month.month}`}
              className="monthly-row"
              aria-label={m.monthSummary(
                formatMonth(month.month),
                formatSigned("income", month.income),
                formatSigned("expense", month.expense),
                `${month.net > 0 ? "+" : ""}${formatSigned("transfer", month.net)}`,
              )}
            >
              <span className="monthly-month">{formatMonthShort(month.month)}</span>
              <span className="monthly-values">
                <span data-kind="income">{formatSigned("income", month.income)}</span>
                <span data-kind="expense">{formatSigned("expense", month.expense)}</span>
                <span className="monthly-net num">
                  {month.net > 0 ? "+" : ""}
                  {formatSigned("transfer", month.net)}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
      <p className="monthly-range">
        {formatDisplayDate(range.from)} – {formatDisplayDate(range.to)}
      </p>
    </section>
  );
}
