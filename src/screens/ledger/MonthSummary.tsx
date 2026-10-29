import { FileSpreadsheet } from "lucide-react";
import { useState } from "react";
import type { BudgetStatus, StatsAssets } from "../../../shared/schema";
import { download, paths } from "../../api/client";
import { useApi } from "../../api/hooks";
import { calendarMonthFilter } from "../../app/periods";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { Skeleton } from "../../components/Skeleton";
import { useMessages } from "../../i18n";
import { common } from "../../i18n/common";
import { formatWon } from "../../i18n/format";
import { Link } from "../../router";
import { ledgerMessages } from "./messages";

function AssetSpending({ month }: { readonly month: string }) {
  const m = useMessages(ledgerMessages);
  const c = useMessages(common);
  const assets = useApi<StatsAssets>(paths.statsAssets(calendarMonthFilter(month)));
  const rows = (assets.data?.rows ?? []).filter((row) => row.expense > 0).sort((a, b) => b.expense - a.expense);
  const total = rows.reduce((sum, row) => sum + row.expense, 0);
  return (
    <section className="summary-panel" aria-labelledby="summary-assets">
      <header className="summary-panel-header">
        <h2 id="summary-assets">{m.assetSpending}</h2>
        <span className="num" data-kind="expense">
          {formatWon(total)}
        </span>
      </header>
      {assets.data === undefined && assets.loading ? <Skeleton rows={2} label={m.loading} /> : null}
      {assets.data === undefined && !assets.loading ? (
        <EmptyState
          tone="error"
          title={c.loadFailed}
          action={
            <Button size="sm" onClick={assets.reload}>
              {c.retry}
            </Button>
          }
        />
      ) : null}
      {assets.data && rows.length === 0 ? <p className="summary-panel-empty">{m.noSpending}</p> : null}
      {rows.length > 0 ? (
        <dl className="summary-rows">
          {rows.map((row) => (
            <div key={row.asset_id}>
              <dt>{row.name}</dt>
              <dd className="num">{formatWon(row.expense)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

function BudgetProgress({ month }: { readonly month: string }) {
  const m = useMessages(ledgerMessages);
  const c = useMessages(common);
  const budget = useApi<BudgetStatus>(paths.budgets(month));
  const total = budget.data?.total;
  const pct = total?.budget ? Math.min(100, Math.round((total.spent / total.budget) * 100)) : 0;
  return (
    <section className="summary-panel" aria-labelledby="summary-budget">
      <header className="summary-panel-header">
        <h2 id="summary-budget">{m.budgetTitle}</h2>
        <Link to="/budget" className="summary-panel-link">
          {m.openBudget}
        </Link>
      </header>
      {budget.data === undefined && budget.loading ? <Skeleton rows={1} label={m.loading} /> : null}
      {budget.data === undefined && !budget.loading ? (
        <EmptyState
          tone="error"
          title={c.loadFailed}
          action={
            <Button size="sm" onClick={budget.reload}>
              {c.retry}
            </Button>
          }
        />
      ) : null}
      {total && total.budget === null ? <p className="summary-panel-empty">{m.noBudget}</p> : null}
      {total && total.budget !== null ? (
        <>
          <div
            className="summary-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label={m.budgetUsed(pct)}
            data-over={total.over || undefined}
          >
            <span style={{ width: `${pct}%` }} />
          </div>
          <p className="summary-progress-text num">
            {m.budgetLine(formatWon(total.spent), formatWon(total.budget))}
            {" · "}
            {total.over && total.remaining !== null
              ? m.budgetOver(formatWon(-total.remaining))
              : m.budgetLeft(formatWon(total.remaining ?? 0))}
          </p>
        </>
      ) : null}
    </section>
  );
}

/** 요약: one month at a glance - spending by asset, the total budget, and an Excel export of the month. */
export default function MonthSummary({ month }: { readonly month: string }) {
  const m = useMessages(ledgerMessages);
  const [exporting, setExporting] = useState(false);
  const [failed, setFailed] = useState(false);
  const range = calendarMonthFilter(month);
  const exportMonth = async () => {
    setExporting(true);
    setFailed(false);
    try {
      await download(paths.exportFile({ format: "xlsx", from: range.from, to: range.to }));
    } catch (error) {
      console.warn("month export failed", error);
      setFailed(true);
    } finally {
      setExporting(false);
    }
  };
  return (
    <div className="month-summary">
      <AssetSpending month={month} />
      <BudgetProgress month={month} />
      <Button icon={FileSpreadsheet} block disabled={exporting} aria-busy={exporting} onClick={() => void exportMonth()}>
        {m.exportMonthExcel}
      </Button>
      {failed ? (
        <p className="field-error" role="alert">
          {m.exportFailed}
        </p>
      ) : null}
    </div>
  );
}
