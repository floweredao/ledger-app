import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { kstMonth } from "../../../shared/dates";
import type {
  CategoryNode,
  StatsAssets,
  StatsCategories,
  StatsCompare,
  StatsMerchants,
  StatsSummary,
  StatsTrend,
} from "../../../shared/schema";
import { type Items, paths } from "../../api/client";
import { useApi } from "../../api/hooks";
import { formatRange, type InclusiveRange } from "../../app/periods";
import { navigate } from "../../router";
import { Button } from "../Button";
import { EmptyState } from "../EmptyState";
import { SegmentedControl } from "../SegmentedControl";
import { Skeleton } from "../Skeleton";
import { Bars } from "./Bars";
import { Donut, type DonutRow } from "./Donut";
import type { StatsPeriod, StatsType } from "./StatsPeriodPicker";

type Props = {
  readonly period: StatsPeriod;
  readonly range: InclusiveRange;
  readonly type: StatsType;
};

const amountText = (amount: number, kind: StatsType) => {
  const signed = kind === "income" ? amount : -amount;
  return `${signed > 0 ? "+" : signed < 0 ? "−" : ""}${Math.abs(signed).toLocaleString("ko-KR")}원`;
};

function searchCategory(row: DonutRow, range: InclusiveRange, type: StatsType): void {
  const query = new URLSearchParams({
    from: range.from,
    to: range.to,
    type,
    category_id: row.category_id ?? "uncategorized",
  });
  navigate(`/search?${query.toString()}`);
}

export function StatsPanels({ period, range, type }: Props) {
  const statsQuery = { ...range, type };
  const summary = useApi<StatsSummary>(paths.statsSummary(statsQuery));
  const categories = useApi<StatsCategories>(paths.statsCategories(statsQuery));
  const compare = useApi<StatsCompare>(paths.statsCompare(statsQuery));
  const categoryTree = useApi<Items<CategoryNode>>(paths.categories({ type, include_hidden: true }));
  const trend = useApi<StatsTrend>(paths.statsTrend({ months: 12, end: kstMonth(), type }));
  const merchants = useApi<StatsMerchants>(paths.statsMerchants({ ...range, limit: 10 }));
  const assets = useApi<StatsAssets>(paths.statsAssets(range));
  const [drilledId, setDrilledId] = useState<string | null>(null);
  const states = [summary, categories, compare, categoryTree, trend, merchants, assets];
  const failure = states.find((state) => state.error);
  const reload = () => {
    summary.reload();
    categories.reload();
    compare.reload();
    categoryTree.reload();
    trend.reload();
    merchants.reload();
    assets.reload();
  };

  if (failure) {
    return (
      <EmptyState
        tone="error"
        icon={AlertCircle}
        title="통계를 불러오지 못했어요"
        action={
          <Button variant="primary" onClick={reload}>
            다시 시도
          </Button>
        }
      />
    );
  }
  if (
    summary.data === undefined ||
    categories.data === undefined ||
    compare.data === undefined ||
    categoryTree.data === undefined ||
    trend.data === undefined ||
    merchants.data === undefined ||
    assets.data === undefined ||
    states.some((state) => state.loading)
  ) {
    return <Skeleton rows={4} label="통계를 불러오는 중" />;
  }
  if (summary.data.count === 0) {
    return <EmptyState title="이 기간에는 기록이 없어요" description="기간을 바꾸거나 기록을 추가해 보세요." />;
  }

  const root = drilledId === null ? undefined : categories.data.rows.find((row) => row.category_id === drilledId);
  const displayRows = root?.children ?? categories.data.rows;
  const deltas = new Map(compare.data.rows.map((row) => [row.category_id ?? "", row.delta]));
  for (const row of categoryTree.data.items) {
    const childrenDelta = row.children.reduce((sum, child) => sum + (deltas.get(child.id) ?? 0), 0);
    deltas.set(row.id, childrenDelta + (deltas.get(row.id) ?? 0));
  }
  const total = type === "expense" ? summary.data.expense : summary.data.income;

  return (
    <div className="stats-content">
      <section className="stats-overview" aria-label={`${type === "expense" ? "지출" : "수입"} 요약`}>
        <p className="stats-overview-label">{type === "expense" ? "총 지출" : "총 수입"}</p>
        <p className="stats-overview-total num">{amountText(total, type)}</p>
        <p className="stats-overview-count num">
          거래 {summary.data.count.toLocaleString("ko-KR")}건 · {formatRange(range)}
        </p>
      </section>
      <div className="stats-grid">
        <section className="stats-panel stats-categories">
          <div className="stats-panel-heading">
            {root ? (
              <Button variant="ghost" size="sm" onClick={() => setDrilledId(null)}>
                ‹ 전체 분류
              </Button>
            ) : null}
            <h2 className="section-title">{root ? `${root.name} 상세` : "분류별"}</h2>
            <SegmentedControl
              label="거래 종류"
              options={[
                { value: "expense", label: "지출" },
                { value: "income", label: "수입" },
              ]}
              value={type}
              onChange={(next) => {
                setDrilledId(null);
                const query = new URLSearchParams({ period, from: range.from, to: range.to, type: next });
                navigate(`/stats?${query.toString()}`, { replace: true });
              }}
            />
          </div>
          <Donut
            rows={displayRows}
            total={root?.amount ?? categories.data.total}
            type={type}
            deltas={deltas}
            onSelect={(row) => {
              if ("children" in row && row.children.length > 0 && row.category_id) setDrilledId(row.category_id);
              else searchCategory(row, range, type);
            }}
          />
        </section>
        <section className="stats-panel">
          <div className="stats-panel-heading">
            <h2 className="section-title">12개월 추이</h2>
            <p className="stats-panel-note">막대를 선택하면 금액을 확인할 수 있어요</p>
          </div>
          <Bars buckets={trend.data.buckets} type={type} currentMonth={kstMonth()} />
        </section>
        {type === "expense" ? (
          <section className="stats-panel">
            <h2 className="section-title">지출 상위 가맹점</h2>
            {merchants.data.rows.length ? (
              <ol className="stats-merchant-list">
                {merchants.data.rows.map((row, index) => (
                  <li className="stats-merchant-row" key={row.merchant_key}>
                    <span className="stats-rank num">{String(index + 1).padStart(2, "0")}</span>
                    <span className="stats-merchant-name">{row.merchant || "이름 없는 가맹점"}</span>
                    <span className="stats-merchant-count num">{row.count.toLocaleString("ko-KR")}건</span>
                    <strong className="num">{amountText(row.amount, "expense")}</strong>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="stats-muted">가맹점 기록이 없어요</p>
            )}
          </section>
        ) : null}
        <section className="stats-panel">
          <h2 className="section-title">자산별 내역</h2>
          <div className="stats-table-scroll">
            <table className="stats-assets-table">
              <thead>
                <tr>
                  <th scope="col">자산</th>
                  <th scope="col">수입</th>
                  <th scope="col">지출</th>
                </tr>
              </thead>
              <tbody>
                {assets.data.rows.map((row) => (
                  <tr key={row.asset_id}>
                    <th scope="row">{row.name}</th>
                    <td className="num">{amountText(row.income, "income")}</td>
                    <td className="num">{amountText(row.expense, "expense")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {states.some((state) => state.offline) ? (
        <p className="stats-offline" role="status">
          오프라인에서 저장된 통계를 보여주고 있어요
        </p>
      ) : null}
    </div>
  );
}
