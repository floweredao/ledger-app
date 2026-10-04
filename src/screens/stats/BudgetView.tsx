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
import { useSelectedMonth } from "../../router";
import { BudgetEditor } from "./BudgetEditor";
import "./budgets.css";

type Selection = {
  readonly categoryId: string | null;
  readonly categoryName: string;
  readonly amount: number | null;
  readonly budgetId: string | null;
  readonly budgetMonth: string | null;
};

const money = (value: number) => `${Math.abs(value).toLocaleString("ko-KR")}원`;
const progressPct = (spent: number, budget: number | null) =>
  budget === null || budget <= 0 ? (spent > 0 ? 100 : 0) : Math.min(100, (spent / budget) * 100);

function remainingDays(from: string, to: string): number {
  const today = kstDate();
  if (today > to) return 0;
  const start = today < from ? from : today;
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

function lineMessage(remaining: number | null, budget: number | null): string {
  if (budget === null) return "총 예산을 설정해 주세요";
  if (remaining === null) return "예산 정보를 확인할 수 없어요";
  if (remaining < 0) return `${money(remaining)} 초과했어요`;
  return `${money(remaining)} 남았어요`;
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
  const hasBudget = item.budget !== null;
  const amountLabel = hasBudget ? `${money(item.spent)} / ${money(item.budget ?? 0)}` : `${money(item.spent)} 지출`;
  return (
    <article className="budget-category-row">
      <CategoryIcon icon={item.icon} color={item.color} />
      <div className="budget-category-main">
        <div className="budget-category-heading">
          <span className="budget-category-name" data-testid="budget-category-name">
            {item.name}
          </span>
          {hasBudget ? (
            <span className={`budget-category-pct${item.over ? " is-over" : ""}`}>{Math.round(item.pct ?? 0)}%</span>
          ) : (
            <span className="budget-needs-setup">미설정</span>
          )}
        </div>
        <BudgetMeter spent={item.spent} budget={item.budget} over={item.over} label={`${item.name} 예산 사용률`} />
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
              aria-label={`${item.name} 예산 추가`}
              onClick={() => onEdit(item)}
            >
              <Plus aria-hidden="true" size={16} />
              예산 추가
            </Button>
          )}
        </div>
      </div>
      {hasBudget ? (
        <Button variant="ghost" size="sm" aria-label={`${item.name} 예산 수정`} onClick={() => onEdit(item)}>
          수정
        </Button>
      ) : null}
    </article>
  );
}

export default function BudgetView() {
  const [month, setMonth] = useSelectedMonth();
  const { data, error, loading, offline, reload } = useApi<BudgetStatus>(paths.budgets(month));
  const [selection, setSelection] = useState<Selection | null>(null);

  const categories = [...(data?.categories ?? [])].sort(
    (a, b) =>
      (a.budget === null ? 1 : 0) - (b.budget === null ? 1 : 0) ||
      (a.budget === null ? b.spent - a.spent : (b.pct ?? 0) - (a.pct ?? 0)),
  );

  const editTotal = () =>
    setSelection({
      categoryId: null,
      categoryName: "전체",
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

  if (loading && !data) return <Skeleton rows={5} label="예산을 불러오는 중" />;
  if (error && !data)
    return (
      <EmptyState
        tone="error"
        icon={CircleAlert}
        title="예산을 불러오지 못했어요"
        description="연결을 확인한 뒤 다시 시도해 주세요."
        action={
          <Button variant="primary" onClick={reload}>
            다시 시도
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
            예산 현황
          </h2>
          <p className="budget-range num">{rangeLabel}</p>
        </div>
        <MonthSwitcher value={month} onChange={setMonth} />
      </header>

      {offline ? (
        <p className="budget-offline" role="status">
          오프라인 저장 예산을 보여주고 있어요
        </p>
      ) : null}
      {error && data ? (
        <p className="budget-refresh-error" role="status">
          최신 예산을 가져오지 못했어요. 저장된 정보를 보여주고 있어요.
        </p>
      ) : null}

      <section className={`budget-total-card${totalOver ? " is-over" : ""}`} aria-label="전체 예산">
        <div className="budget-total-top">
          <div>
            <p className="budget-eyebrow">이번 기간 전체 예산</p>
            <p className="budget-total-amount num">
              {data.total.budget === null ? "미설정" : money(data.total.budget)}
            </p>
          </div>
          <Button variant="secondary" onClick={editTotal} aria-label="총 예산 설정">
            {data.total.budget === null ? "예산 설정" : "예산 수정"}
          </Button>
        </div>
        <BudgetMeter spent={data.total.spent} budget={data.total.budget} over={totalOver} label="전체 예산 사용률" />
        <div className="budget-total-stats">
          <div>
            <span className="budget-stat-label">사용</span>
            <strong className="num">{money(data.total.spent)}</strong>
          </div>
          <div>
            <span className="budget-stat-label">남은 예산</span>
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
          {days > 0 ? `기간 종료까지 ${days}일 남았어요` : "예산 기간이 끝났어요"}
        </p>
      </section>

      <section className="budget-categories" aria-labelledby="budget-categories-heading">
        <div className="budget-section-heading">
          <h3 className="section-title" id="budget-categories-heading">
            분류별 예산
          </h3>
          <span>{categories.length}개</span>
        </div>
        {categories.length === 0 ? (
          <EmptyState
            icon={RotateCcw}
            title="이번 기간 지출이 없어요"
            description="지출이 기록되면 분류별 예산을 확인할 수 있어요."
          />
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
        categoryName={selection?.categoryName ?? "전체"}
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
