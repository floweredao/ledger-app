import { Search } from "lucide-react";
import { useEffect } from "react";
import { kstMonth } from "../../../shared/dates";
import { formatSigned, formatWon } from "../../../shared/money";
import type { Settings, StatsSummary } from "../../../shared/schema";
import { paths } from "../../api/client";
import { useApi } from "../../api/hooks";
import { calendarMonthFilter, calendarYearFilter } from "../../app/periods";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { MonthSwitcher } from "../../components/MonthSwitcher";
import { SegmentedLinks } from "../../components/SegmentedControl";
import { Skeleton } from "../../components/Skeleton";
import { Link, navigate, useRoute, useSelectedMonth, useSelectedYear } from "../../router";
import CalendarView from "./CalendarView";
import DailyList from "./DailyList";
import MonthlyView from "./MonthlyView";

type View = "daily" | "calendar" | "monthly";

function SummaryCard({ view, month, year }: { readonly view: View; readonly month: string; readonly year: string }) {
  const filter = view === "monthly" ? calendarYearFilter(year) : calendarMonthFilter(month);
  const summary = useApi<StatsSummary>(paths.statsSummary(filter));
  const caption = view === "monthly" ? `${year}년 합계` : "이번 달 합계";
  if (summary.data === undefined && summary.loading) return <Skeleton variant="block" label="합계 불러오는 중" />;
  if (summary.data === undefined) {
    return (
      <EmptyState
        tone="error"
        title="합계를 불러오지 못했어요"
        action={
          <Button size="sm" onClick={summary.reload}>
            다시 시도
          </Button>
        }
      />
    );
  }
  const { income, expense, net } = summary.data;
  return (
    <section className="summary-card" aria-label={caption}>
      <dl className="summary-grid">
        <div>
          <dt>수입</dt>
          <dd className="num" data-kind="income">
            {income === 0 ? formatWon(0) : formatSigned("income", income)}
          </dd>
        </div>
        <div>
          <dt>지출</dt>
          <dd className="num" data-kind="expense">
            {expense === 0 ? formatWon(0) : formatSigned("expense", expense)}
          </dd>
        </div>
        <div>
          <dt>합계</dt>
          <dd className="num">{net === 0 ? formatWon(0) : net < 0 ? `-${formatWon(-net)}` : `+${formatWon(net)}`}</dd>
        </div>
      </dl>
    </section>
  );
}

export default function LedgerScreen() {
  const route = useRoute();
  const [month, setMonth] = useSelectedMonth();
  const [year, setYear] = useSelectedYear();
  const view: View = route.name === "calendar" ? "calendar" : route.name === "monthly" ? "monthly" : "daily";
  const settings = useApi<Settings>(paths.settings);
  // A bare `/` (app start, the 가계부 tab) opens the tab chosen in settings; links with a period stay put.
  const bare = route.name === "ledger" && route.query.toString() === "";
  const start = settings.data?.ledger_view ?? (settings.loading ? undefined : "daily");
  const redirecting = bare && start !== "daily";
  useEffect(() => {
    if (bare && (start === "calendar" || start === "monthly")) navigate(`/${start}`, { replace: true });
  }, [bare, start]);
  const monthForLinks = view === "monthly" && month.slice(0, 4) !== year ? `${year}-${kstMonth().slice(5)}` : month;

  return (
    <div className="screen">
      <header className="screen-header">
        <h1 className="screen-title">가계부</h1>
        <Link to="/search" className="icon-btn" aria-label="검색">
          <Search aria-hidden="true" size={20} strokeWidth={2} />
        </Link>
      </header>
      {view === "monthly" ? (
        <MonthSwitcher unit="year" value={year} onChange={setYear} />
      ) : (
        <MonthSwitcher value={month} onChange={setMonth} />
      )}
      <SummaryCard view={view} month={month} year={year} />
      <SegmentedLinks
        label="가계부 보기"
        items={[
          { label: "일일", to: `/?month=${monthForLinks}`, current: view === "daily" },
          { label: "달력", to: `/calendar?month=${monthForLinks}`, current: view === "calendar" },
          {
            label: "월별",
            to: `/monthly?year=${view === "monthly" ? year : month.slice(0, 4)}`,
            current: view === "monthly",
          },
        ]}
      />
      {redirecting ? <Skeleton rows={4} label="가계부 여는 중" /> : null}
      {view === "daily" && !redirecting ? <DailyList /> : null}
      {view === "calendar" ? <CalendarView /> : null}
      {view === "monthly" ? <MonthlyView /> : null}
    </div>
  );
}
