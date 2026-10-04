import "./daily.css";
import { formatDisplayDate } from "../../../shared/dates";
import { formatSigned } from "../../../shared/money";
import type { StatsTrend } from "../../../shared/schema";
import { paths } from "../../api/client";
import { useApi } from "../../api/hooks";
import { calendarYearFilter } from "../../app/periods";
import { EmptyState } from "../../components/EmptyState";
import { Skeleton } from "../../components/Skeleton";
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
  const [year] = useSelectedYear();
  const range = calendarYearFilter(year);
  const trend = useApi<StatsTrend>(paths.statsTrend({ end: `${year}-12`, months: 12, basis: "calendar" }));
  const buckets = trend.data?.buckets;

  if (!buckets && trend.loading) return <Skeleton rows={6} label={`${year}년 월별 내역 불러오는 중`} />;
  if (!buckets) {
    return <EmptyState tone="error" title="월별 내역을 불러오지 못했어요" description="잠시 후 다시 시도해 주세요." />;
  }

  return (
    <section className="monthly-view" aria-label={`${year}년 월별 내역`}>
      <div className="monthly-grid">
        {monthsFor(year, buckets).map((month) => {
          const monthNumber = Number(month.month.slice(5, 7));
          return (
            <Link
              key={month.month}
              to={`/?month=${month.month}`}
              className="monthly-row"
              aria-label={`${year}년 ${monthNumber}월 수입 ${formatSigned("income", month.income)}, 지출 ${formatSigned("expense", month.expense)}, 합계 ${month.net > 0 ? "+" : ""}${formatSigned("transfer", month.net)}`}
            >
              <span className="monthly-month">{monthNumber}월</span>
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
