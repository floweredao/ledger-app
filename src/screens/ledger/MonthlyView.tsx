import { useMessages } from "../../i18n";
import { ledgerMessages } from "./messages";
import "./daily.css";
import { addDays, daysInMonth, kstDate, kstMonth } from "../../../shared/dates";
import type { StatsTrend, TransactionList } from "../../../shared/schema";
import { paths } from "../../api/client";
import { useApi } from "../../api/hooks";
import { calendarMonthFilter, calendarYearFilter } from "../../app/periods";
import { EmptyState } from "../../components/EmptyState";
import { Skeleton } from "../../components/Skeleton";
import { formatDisplayDate, formatMonth, formatMonthShort, formatSigned, formatWon } from "../../i18n/format";
import { Link, useSelectedYear } from "../../router";

type Totals = { readonly income: number; readonly expense: number; readonly net: number };
type MonthTotal = Totals & { readonly month: string };
type WeekTotal = Totals & { readonly from: string; readonly to: string };

function monthsFor(year: string, buckets: StatsTrend["buckets"]): readonly MonthTotal[] {
  const totals = new Map(buckets.map((bucket) => [bucket.month, bucket]));
  return Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, "0")}`;
    const total = totals.get(month);
    return { month, income: total?.income ?? 0, expense: total?.expense ?? 0, net: total?.net ?? 0 };
  });
}

/** Sunday-to-Saturday weeks clipped to the month, each with its income / expense / net. */
function weeksOf(month: string, items: TransactionList["items"]): readonly WeekTotal[] {
  const last = `${month}-${String(daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)))).padStart(2, "0")}`;
  const weeks: WeekTotal[] = [];
  let from = `${month}-01`;
  while (from <= last) {
    const weekday = new Date(`${from}T00:00:00Z`).getUTCDay();
    const end = addDays(from, 6 - weekday);
    const to = end > last ? last : end;
    let income = 0;
    let expense = 0;
    for (const item of items) {
      const day = kstDate(item.occurred_at);
      if (day < from || day > to) continue;
      if (item.type === "income") income += item.amount;
      if (item.type === "expense") expense += item.is_refund ? -item.amount : item.amount;
    }
    weeks.push({ from, to, income, expense, net: income - expense });
    from = addDays(to, 1);
  }
  return weeks.reverse();
}

const signedNet = (net: number) => `${net > 0 ? "+" : ""}${formatSigned("transfer", net)}`;
const signedOrZero = (type: "income" | "expense", amount: number) =>
  amount === 0 ? formatWon(0) : formatSigned(type, amount);

function Values({ totals }: { readonly totals: Totals }) {
  return (
    <span className="monthly-values num">
      <span data-kind="income">{signedOrZero("income", totals.income)}</span>
      <span data-kind="expense">{signedOrZero("expense", totals.expense)}</span>
      <span className="monthly-net">{signedNet(totals.net)}</span>
    </span>
  );
}

function Weeks({ month }: { readonly month: string }) {
  const m = useMessages(ledgerMessages);
  const range = calendarMonthFilter(month);
  const list = useApi<TransactionList>(paths.transactions({ from: range.from, to: range.to, limit: 1000 }));
  if (!list.data) return null;
  const today = kstDate();
  return (
    <ul className="monthly-weeks" aria-label={m.weeksOf(formatMonth(month))}>
      {weeksOf(month, list.data.items).map((week) => (
        <li key={week.from} className="monthly-week" data-current={(week.from <= today && today <= week.to) || undefined}>
          <span className="monthly-week-range num">
            {`${week.from.slice(5).replace("-", "/")}~${week.to.slice(5).replace("-", "/")}`}
          </span>
          <Values totals={week} />
        </li>
      ))}
    </ul>
  );
}

export default function MonthlyView() {
  const m = useMessages(ledgerMessages);

  const [year] = useSelectedYear();
  const range = calendarYearFilter(year);
  const trend = useApi<StatsTrend>(paths.statsTrend({ end: `${year}-12`, months: 12, basis: "calendar" }));
  const buckets = trend.data?.buckets;
  const currentMonth = kstMonth();

  if (!buckets && trend.loading) return <Skeleton rows={6} label={m.loadingYear(year)} />;
  if (!buckets) {
    return <EmptyState tone="error" title={m.loadMonthlyFailed} description={m.tryLater} />;
  }

  return (
    <section className="monthly-view" aria-label={m.yearRecords(year)}>
      <div className="monthly-grid">
        {monthsFor(year, buckets).map((month) => (
          <div key={month.month} className="monthly-block">
            <Link
              to={`/?month=${month.month}`}
              className="monthly-row"
              aria-label={m.monthSummary(
                formatMonth(month.month),
                formatSigned("income", month.income),
                formatSigned("expense", month.expense),
                signedNet(month.net),
              )}
            >
              <span className="monthly-month">{formatMonthShort(month.month)}</span>
              <Values totals={month} />
            </Link>
            {month.month === currentMonth ? <Weeks month={month.month} /> : null}
          </div>
        ))}
      </div>
      <p className="monthly-range">
        {formatDisplayDate(range.from)} – {formatDisplayDate(range.to)}
      </p>
    </section>
  );
}
