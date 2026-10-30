import { Search, SlidersHorizontal, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { kstMonth } from "../../../shared/dates";
import type { Settings, StatsSummary } from "../../../shared/schema";
import { paths } from "../../api/client";
import { useApi } from "../../api/hooks";
import { calendarMonthFilter, calendarYearFilter } from "../../app/periods";
import { Button, IconButton } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { MonthSwitcher } from "../../components/MonthSwitcher";
import { UnderlineTabs } from "../../components/SegmentedControl";
import { Skeleton } from "../../components/Skeleton";
import { useMessages } from "../../i18n";
import { common } from "../../i18n/common";
import { formatWon } from "../../i18n/format";
import { Link, navigate, useRoute, useSelectedMonth, useSelectedYear } from "../../router";
import CalendarView from "./CalendarView";
import DailyList from "./DailyList";
import FavoritesSheet from "./FavoritesSheet";
import MonthlyView from "./MonthlyView";
import MonthNote from "./MonthNote";
import MonthSummary from "./MonthSummary";
import { ledgerMessages } from "./messages";
import "./ledger.css";

type View = "daily" | "calendar" | "monthly" | "summary" | "memo";

const VIEW_OF: Readonly<Record<string, View>> = {
  calendar: "calendar",
  monthly: "monthly",
  summary: "summary",
  memo: "memo",
};

function signedNet(net: number): string {
  if (net === 0) return formatWon(0);
  return net < 0 ? `-${formatWon(-net)}` : `+${formatWon(net)}`;
}

/** One line of income / expense / total at equal weight, under the sub-tabs. */
function SummaryStrip({ view, month, year }: { readonly view: View; readonly month: string; readonly year: string }) {
  const m = useMessages(ledgerMessages);
  const c = useMessages(common);
  const filter = view === "monthly" ? calendarYearFilter(year) : calendarMonthFilter(month);
  const summary = useApi<StatsSummary>(paths.statsSummary(filter));
  const caption = view === "monthly" ? m.yearTotal(year) : m.monthlyTotal;
  if (summary.data === undefined && summary.loading) return <Skeleton variant="block" label={m.loadingTotal} />;
  if (summary.data === undefined) {
    return (
      <EmptyState
        tone="error"
        title={m.loadTotalFailed}
        action={
          <Button size="sm" onClick={summary.reload}>
            {c.retry}
          </Button>
        }
      />
    );
  }
  const { income, expense, net } = summary.data;
  return (
    <section className="summary-strip" aria-label={caption}>
      <dl className="summary-strip-grid">
        <div>
          <dt>{c.income}</dt>
          <dd className="num" data-kind="income">
            {formatWon(income)}
          </dd>
        </div>
        <div>
          <dt>{c.expense}</dt>
          <dd className="num" data-kind="expense">
            {formatWon(expense)}
          </dd>
        </div>
        <div>
          <dt>{m.total}</dt>
          <dd className="num">{signedNet(net)}</dd>
        </div>
      </dl>
    </section>
  );
}

export default function LedgerScreen() {
  const m = useMessages(ledgerMessages);
  const c = useMessages(common);

  const route = useRoute();
  const [month, setMonth] = useSelectedMonth();
  const [year, setYear] = useSelectedYear();
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const view: View = VIEW_OF[route.name] ?? "daily";
  const settings = useApi<Settings>(paths.settings);
  // A bare `/` (app start, the 가계부 tab) opens the tab chosen in settings; links with a period stay put.
  const bare = route.name === "ledger" && route.query.toString() === "";
  const start = settings.data?.ledger_view ?? (settings.loading ? undefined : "daily");
  const redirecting = bare && start !== "daily";
  useEffect(() => {
    if (bare && (start === "calendar" || start === "monthly")) navigate(`/${start}`, { replace: true });
  }, [bare, start]);
  const monthForLinks = view === "monthly" && month.slice(0, 4) !== year ? `${year}-${kstMonth().slice(5)}` : month;
  const range = calendarMonthFilter(monthForLinks);

  return (
    <div className="screen ledger-screen">
      <header className="ledger-topbar">
        <Link to="/search" className="icon-btn" aria-label={m.search}>
          <Search aria-hidden="true" size={22} strokeWidth={2} />
        </Link>
        <h1 className="ledger-topbar-title">{c.appName}</h1>
        <div className="ledger-topbar-actions">
          <IconButton label={m.favorites} icon={Star} onClick={() => setFavoritesOpen(true)} />
          <Link to={`/search?from=${range.from}&to=${range.to}&filters=1`} className="icon-btn" aria-label={m.filters}>
            <SlidersHorizontal aria-hidden="true" size={22} strokeWidth={2} />
          </Link>
        </div>
      </header>
      {view === "monthly" ? (
        <MonthSwitcher unit="year" value={year} onChange={setYear} />
      ) : (
        <MonthSwitcher value={month} onChange={setMonth} />
      )}
      <UnderlineTabs
        label={m.ledgerView}
        items={[
          { label: m.daily, to: `/?month=${monthForLinks}`, current: view === "daily" },
          { label: m.calendar, to: `/calendar?month=${monthForLinks}`, current: view === "calendar" },
          {
            label: m.monthly,
            to: `/monthly?year=${view === "monthly" ? year : month.slice(0, 4)}`,
            current: view === "monthly",
          },
          { label: m.summary, to: `/summary?month=${monthForLinks}`, current: view === "summary" },
          { label: m.memo, to: `/memo?month=${monthForLinks}`, current: view === "memo" },
        ]}
      />
      {view === "memo" ? null : <SummaryStrip view={view} month={month} year={year} />}
      {redirecting ? <Skeleton rows={4} label={m.openingLedger} /> : null}
      {view === "daily" && !redirecting ? <DailyList /> : null}
      {view === "calendar" ? <CalendarView /> : null}
      {view === "monthly" ? <MonthlyView /> : null}
      {view === "summary" ? <MonthSummary month={month} /> : null}
      {view === "memo" ? <MonthNote key={month} month={month} /> : null}
      <FavoritesSheet open={favoritesOpen} onClose={() => setFavoritesOpen(false)} />
    </div>
  );
}
