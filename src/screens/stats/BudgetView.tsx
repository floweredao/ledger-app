import { CalendarClock, CircleAlert, Plus, RotateCcw } from "lucide-react";
import { useState } from "react";
import { kstDate } from "../../../shared/dates";
import type { BudgetStatus } from "../../../shared/schema";
import { paths } from "../../api/client";
import { invalidate, useApi } from "../../api/hooks";
import { Button } from "../../components/Button";
import { CategoryIcon } from "../../components/CategoryIcon";
import { EmptyState } from "../../components/EmptyState";
import { MonthSwitcher } from "../../components/MonthSwitcher";
import { Skeleton } from "../../components/Skeleton";
import { messages, useMessages } from "../../i18n";
import { common } from "../../i18n/common";
import { formatNumber, formatWon } from "../../i18n/format";
import { useSelectedMonth } from "../../router";
import { BudgetEditor } from "./BudgetEditor";
import { budgetMessages } from "./budget-messages";
import "./budgets.css";

type Selection = {
  readonly categoryId: string | null;
  readonly categoryName: string;
  readonly amount: number | null;
  readonly budgetId: string | null;
  readonly budgetMonth: string | null;
};

const money = (value: number) => formatWon(Math.abs(value));
const progressPct = (spent: number, budget: number | null) =>
  budget === null || budget <= 0 ? (spent > 0 ? 100 : 0) : Math.min(100, (spent / budget) * 100);

function remainingDays(from: string, to: string): number {
  const today = kstDate();
  if (today > to) return 0;
  const start = today < from ? from : today;
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

function lineMessage(remaining: number | null, budget: number | null): string {
  const m = messages(budgetMessages);
  if (budget === null) return m.setTotalHint;
  if (remaining === null) return m.unavailable;
  if (remaining < 0) return m.overBudget(money(remaining));
  return m.remainingAmount(money(remaining));
}

function BudgetMeter({
  spent,
  budget,
  over,
  label,
}: {
  readonly spent: number;
  readonly budget: number | null;
  readonly over: boolean;
  readonly label: string;
}) {
  return (
    <div
      className={`budget-meter${over ? " budget-meter-over" : ""}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, Math.round(progressPct(spent, budget)))}
    >
      <span style={{ width: `${progressPct(spent, budget)}%` }} />
    </div>
  );
}

function CategoryRow({
  item,
  onEdit,
}: {
  readonly item: BudgetStatus["categories"][number];
  readonly onEdit: (item: BudgetStatus["categories"][number]) => void;
}) {
  const m = useMessages(budgetMessages);
  const c = useMessages(common);
  const hasBudget = item.budget !== null;
  const amountLabel = hasBudget
    ? `${money(item.spent)} / ${money(item.budget ?? 0)}`
    : m.spentAmount(money(item.spent));
  return (
    <article className="budget-category-row">
      <CategoryIcon icon={item.icon} color={item.color} />
      <div className="budget-category-main">
        <div className="budget-category-heading">
          <span className="budget-category-name" data-testid="budget-category-name">
            {item.name}
          </span>
          {hasBudget ? (
            <span className={`budget-category-pct${item.over ? " is-over" : ""}`}>
              {formatNumber(Math.round(item.pct ?? 0))}%
            </span>
          ) : (
            <span className="budget-needs-setup">{m.unset}</span>
          )}
        </div>
        <BudgetMeter spent={item.spent} budget={item.budget} over={item.over} label={m.usageLabel(item.name)} />
        <div className="budget-category-detail">
          <span className="num">{amountLabel}</span>
          {hasBudget ? (
            <span className={item.over ? "is-over" : "budget-category-remaining"}>
              {lineMessage(item.remaining, item.budget)}
            </span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="budget-add"
              aria-label={m.addNamed(item.name)}
              onClick={() => onEdit(item)}
            >
              <Plus aria-hidden="true" size={16} />
              {m.addBudget}
            </Button>
          )}
        </div>
      </div>
      {hasBudget ? (
        <Button variant="ghost" size="sm" aria-label={m.editNamed(item.name)} onClick={() => onEdit(item)}>
          {c.edit}
        </Button>
      ) : null}
    </article>
  );
}

export default function BudgetView() {
  const m = useMessages(budgetMessages);
  const c = useMessages(common);
  const [month, setMonth] = useSelectedMonth();
  const { data, error, loading, offline, reload } = useApi<BudgetStatus>(paths.budgets(month));
  const [selection, setSelection] = useState<Selection | null>(null);
  const [order, setOrder] = useState<{ month: string; ids: readonly string[] }>({ month, ids: [] });

  const ranked = [...(data?.categories ?? [])].sort(
    (a, b) =>
      (a.budget === null ? 1 : 0) - (b.budget === null ? 1 : 0) ||
      (a.budget === null ? b.spent - a.spent : (b.pct ?? 0) - (a.pct ?? 0)),
  );
  // Reading order belongs to this screen visit, not to changing usage values.
  // A month change starts a new order; newly appearing categories append.
  const ids = order.month === month ? order.ids : [];
  const added = ranked.filter((item) => !ids.includes(item.category_id)).map((item) => item.category_id);
  const currentIds = [...ids, ...added];
  if (order.month !== month || added.length > 0) setOrder({ month, ids: currentIds });
  const categories = ranked.sort((a, b) => currentIds.indexOf(a.category_id) - currentIds.indexOf(b.category_id));

  const editTotal = () =>
    setSelection({
      categoryId: null,
      categoryName: m.all,
      amount: data?.total.budget ?? null,
      budgetId: data?.total.budget_id ?? null,
      budgetMonth: data?.total.budget_month ?? null,
    });

  const editCategory = (item: BudgetStatus["categories"][number]) =>
    setSelection({
      categoryId: item.category_id,
      categoryName: item.name,
      amount: item.budget,
      budgetId: item.budget_id,
      budgetMonth: item.budget_month,
    });

  if (loading && !data) return <Skeleton rows={5} label={m.loading} />;
  if (error && !data)
    return (
      <EmptyState
        tone="error"
        icon={CircleAlert}
        title={m.loadError}
        description={m.checkConnection}
        action={
          <Button variant="primary" onClick={reload}>
            {c.retry}
          </Button>
        }
      />
    );
  if (!data) return null;

  const totalOver = data.total.over;
  const days = remainingDays(data.range.from, data.range.to);
  const rangeLabel = `${data.range.from} – ${data.range.to}`;
  return (
    <section className="budget-view" aria-labelledby="budget-heading">
      <header className="budget-header">
        <div>
          <h2 className="section-title" id="budget-heading">
            {m.title}
          </h2>
          <p className="budget-range num">{rangeLabel}</p>
        </div>
        <MonthSwitcher value={month} onChange={setMonth} />
      </header>

      {offline ? (
        <p className="budget-offline" role="status">
          {m.offline}
        </p>
      ) : null}
      {error && data ? (
        <p className="budget-refresh-error" role="status">
          {m.refreshError}
        </p>
      ) : null}

      <section className={`budget-total-card${totalOver ? " is-over" : ""}`} aria-label={m.totalBudget}>
        <div className="budget-total-top">
          <div>
            <p className="budget-eyebrow">{m.periodBudget}</p>
            <p className="budget-total-amount num">{data.total.budget === null ? m.unset : money(data.total.budget)}</p>
          </div>
          <Button variant="secondary" onClick={editTotal} aria-label={m.setTotal}>
            {data.total.budget === null ? m.setBudget : m.editBudget}
          </Button>
        </div>
        <BudgetMeter spent={data.total.spent} budget={data.total.budget} over={totalOver} label={m.totalUsage} />
        <div className="budget-total-stats">
          <div>
            <span className="budget-stat-label">{m.spent}</span>
            <strong className="num">{money(data.total.spent)}</strong>
          </div>
          <div>
            <span className="budget-stat-label">{m.remaining}</span>
            <strong className={`num${totalOver ? " is-over" : ""}`}>
              {data.total.remaining === null
                ? "—"
                : `${data.total.remaining < 0 ? "−" : ""}${money(data.total.remaining)}`}
            </strong>
          </div>
        </div>
        <p className={`budget-total-message${totalOver ? " is-over" : ""}`} aria-live="polite">
          {lineMessage(data.total.remaining, data.total.budget)}
        </p>
        <p className="budget-days">
          <CalendarClock aria-hidden="true" size={16} />
          {days > 0 ? m.daysRemaining(days) : m.ended}
        </p>
      </section>

      <section className="budget-categories" aria-labelledby="budget-categories-heading">
        <div className="budget-section-heading">
          <h3 className="section-title" id="budget-categories-heading">
            {m.categories}
          </h3>
          <span>{m.categoryCount(categories.length)}</span>
        </div>
        {categories.length === 0 ? (
          <EmptyState icon={RotateCcw} title={m.empty} description={m.emptyHint} />
        ) : (
          <div className="budget-category-list">
            {categories.map((item) => (
              <CategoryRow key={item.category_id} item={item} onEdit={editCategory} />
            ))}
          </div>
        )}
      </section>

      <BudgetEditor
        key={`${month}:${selection?.categoryId ?? "total"}`}
        open={selection !== null}
        onClose={() => setSelection(null)}
        month={month}
        categoryId={selection?.categoryId ?? null}
        categoryName={selection?.categoryName ?? m.all}
        amount={selection?.amount ?? null}
        budgetId={selection?.budgetId ?? null}
        budgetMonth={selection?.budgetMonth ?? null}
        onSaved={() => invalidate("budgets")}
        onDeleted={() => {
          setSelection(null);
          invalidate("budgets");
        }}
      />
    </section>
  );
}
