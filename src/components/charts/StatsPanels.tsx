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
import { useMessages } from "../../i18n";
import { common } from "../../i18n/common";
import { formatNumber, formatWon } from "../../i18n/format";
import { navigate } from "../../router";
import { Button } from "../Button";
import { EmptyState } from "../EmptyState";
import { SegmentedControl } from "../SegmentedControl";
import { Skeleton } from "../Skeleton";
import { Bars } from "./Bars";
import { Donut, type DonutRow } from "./Donut";
import { chartMessages } from "./messages";
import type { StatsPeriod, StatsType } from "./StatsPeriodPicker";

type Props = {
  readonly period: StatsPeriod;
  readonly range: InclusiveRange;
  readonly type: StatsType;
};

const amountText = (amount: number, kind: StatsType) => {
  const signed = kind === "income" ? amount : -amount;
  return `${signed > 0 ? "+" : signed < 0 ? "−" : ""}${formatWon(Math.abs(signed))}`;
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
  const m = useMessages(chartMessages);
  const c = useMessages(common);
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
        title={m.loadFailed}
        action={
          <Button variant="primary" onClick={reload}>
            {c.retry}
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
    return <Skeleton rows={4} label={m.loading} />;
  }
  if (summary.data.count === 0) {
    return <EmptyState title={m.noRecords} description={m.noRecordsHint} />;
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
      <section className="stats-overview" aria-label={type === "expense" ? m.expenseSummary : m.incomeSummary}>
        <p className="stats-overview-label">{type === "expense" ? m.totalExpense : m.totalIncome}</p>
        <p className="stats-overview-total num">{amountText(total, type)}</p>
        <p className="stats-overview-count num">
          {m.recordCount(formatNumber(summary.data.count))} · {formatRange(range)}
        </p>
      </section>
      <div className="stats-grid">
        <section className="stats-panel stats-categories">
          <div className="stats-panel-heading">
            {root ? (
              <Button variant="ghost" size="sm" onClick={() => setDrilledId(null)}>
                {m.allCategories}
              </Button>
            ) : null}
            <h2 className="section-title">{root ? m.categoryDetail(root.name) : m.byCategory}</h2>
            <SegmentedControl
              label={m.transactionKind}
              options={[
                { value: "expense", label: c.expense },
                { value: "income", label: c.income },
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
            <h2 className="section-title">{m.trend}</h2>
            <p className="stats-panel-note">{m.barHint}</p>
          </div>
          <Bars buckets={trend.data.buckets} type={type} currentMonth={kstMonth()} />
        </section>
        {type === "expense" ? (
          <section className="stats-panel">
            <h2 className="section-title">{m.topMerchants}</h2>
            {merchants.data.rows.length ? (
              <ol className="stats-merchant-list">
                {merchants.data.rows.map((row, index) => (
                  <li className="stats-merchant-row" key={row.merchant_key}>
                    <span className="stats-rank num">{String(index + 1).padStart(2, "0")}</span>
                    <span className="stats-merchant-name">{row.merchant || m.unnamedMerchant}</span>
                    <span className="stats-merchant-count num">{m.count(formatNumber(row.count))}</span>
                    <strong className="num">{amountText(row.amount, "expense")}</strong>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="stats-muted">{m.noMerchants}</p>
            )}
          </section>
        ) : null}
        <section className="stats-panel">
          <h2 className="section-title">{m.byAsset}</h2>
          <div className="stats-table-scroll">
            <table className="stats-assets-table">
              <thead>
                <tr>
                  <th scope="col">{m.asset}</th>
                  <th scope="col">{c.income}</th>
                  <th scope="col">{c.expense}</th>
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
          {m.offline}
        </p>
      ) : null}
    </div>
  );
}
