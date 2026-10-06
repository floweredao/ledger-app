import "./daily.css";
import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { kstDate } from "../../../shared/dates";
import { formatSigned } from "../../../shared/money";
import type { Asset, Category, CategoryNode, Transaction } from "../../../shared/schema";
import { api, paths } from "../../api/client";
import { invalidate, useApi } from "../../api/hooks";
import { isPendingTransaction } from "../../api/outbox";
import { openEntry } from "../../app/entry-bridge";
import { calendarMonthFilter } from "../../app/periods";
import { originalNameLine, TRANSFER_ICON, transactionTitle, transferRoute } from "../../app/transaction-label";
import { AmountText } from "../../components/AmountText";
import { Button } from "../../components/Button";
import { CategoryIcon } from "../../components/CategoryIcon";
import { EmptyState } from "../../components/EmptyState";
import { Badge, ListRow } from "../../components/ListRow";
import { Skeleton } from "../../components/Skeleton";
import { useSelectedMonth } from "../../router";

type TransactionResponse = { readonly items: readonly Transaction[] };
type CategoryResponse = { readonly items: readonly CategoryNode[] };
type DayGroup = {
  readonly date: string;
  readonly transactions: readonly Transaction[];
  readonly income: number;
  readonly expense: number;
};

const AUTOMATIC_SOURCES = new Set(["kakaobank_excel", "kakaobank_sms", "import", "recurring", "card_payment"]);

function dateLabel(date: string): string {
  const value = new Date(`${date}T12:00:00+09:00`);
  return `${Number(date.slice(8, 10))}일 ${new Intl.DateTimeFormat("ko-KR", { weekday: "long", timeZone: "Asia/Seoul" }).format(value)}`;
}

function groupTransactions(items: readonly Transaction[]): readonly DayGroup[] {
  const groups = new Map<string, Transaction[]>();
  for (const item of items) {
    const day = kstDate(item.occurred_at);
    const group = groups.get(day) ?? [];
    group.push(item);
    groups.set(day, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, transactions]) => ({
      date,
      transactions,
      income: transactions.reduce((total, item) => total + (item.type === "income" ? item.amount : 0), 0),
      expense: transactions.reduce(
        (total, item) => total + (item.type === "expense" ? (item.is_refund ? -item.amount : item.amount) : 0),
        0,
      ),
    }));
}

function DaySection({
  group,
  categories,
  assets,
}: {
  readonly group: DayGroup;
  readonly categories: ReadonlyMap<string, Category>;
  readonly assets: ReadonlyMap<string, string>;
}) {
  return (
    <section className="daily-day" aria-label={dateLabel(group.date)}>
      <header className="daily-day-header">
        <h2>{dateLabel(group.date)}</h2>
        <div className="daily-day-totals">
          <span>수입 {formatSigned("income", group.income)}</span>
          <span>지출 {formatSigned("expense", group.expense)}</span>
        </div>
      </header>
      <div className="daily-day-rows">
        {group.transactions.map((transaction) => {
          const category = transaction.category_id ? categories.get(transaction.category_id) : undefined;
          const title = transactionTitle(transaction, category?.name);
          const foreignAmount =
            transaction.currency !== "KRW" && transaction.foreign_amount !== null
              ? `${transaction.type === "expense" && !transaction.is_refund ? "-" : transaction.type === "transfer" ? "" : "+"}${transaction.currency} ${transaction.foreign_amount.toLocaleString("ko-KR", { maximumFractionDigits: 4 })}`
              : null;
          const assetName = transaction.asset_id ? assets.get(transaction.asset_id) : undefined;
          const route = transferRoute(transaction, (id) => assets.get(id));
          const subtitle = [
            transaction.memo,
            originalNameLine(transaction),
            route ?? assetName ?? transaction.src_account ?? undefined,
          ]
            .filter(Boolean)
            .join(" · ");
          const badges = (
            <span className="daily-badges">
              {isPendingTransaction(transaction.id) ? <Badge tone="accent">대기</Badge> : null}
              {AUTOMATIC_SOURCES.has(transaction.source) ? (
                <Badge>
                  <span className="daily-source-dot" aria-hidden="true" />
                  자동
                </Badge>
              ) : null}
              {transaction.is_refund ? <Badge tone="accent">환불</Badge> : null}
              {transaction.krw_status === "pending" ? <Badge tone="warning">원화 미확정</Badge> : null}
            </span>
          );
          return (
            <ListRow
              key={transaction.id}
              leading={
                <CategoryIcon
                  icon={category?.icon ?? (transaction.type === "transfer" ? TRANSFER_ICON : undefined)}
                  color={category?.color}
                />
              }
              title={title}
              subtitle={subtitle || undefined}
              badges={badges}
              trailing={
                <span className="daily-row-amount">
                  {transaction.krw_status === "pending" && transaction.amount === 0 && foreignAmount ? (
                    <span className="num">{foreignAmount}</span>
                  ) : (
                    <>
                      <AmountText
                        type={transaction.type}
                        amount={transaction.amount}
                        isRefund={transaction.is_refund}
                      />
                      {foreignAmount ? <span className="daily-row-foreign num">{foreignAmount}</span> : null}
                    </>
                  )}
                </span>
              }
              onClick={() => openEntry({ id: transaction.id })}
            />
          );
        })}
      </div>
    </section>
  );
}

export default function DailyList() {
  const [month] = useSelectedMonth();
  const range = calendarMonthFilter(month);
  const transactionKey = paths.transactions({ from: range.from, to: range.to, limit: 1000 });
  const transactions = useApi<TransactionResponse>(transactionKey);
  const listReady = transactions.data !== undefined;
  const categories = useApi<CategoryResponse>(paths.categories({ include_hidden: true }));
  const assets = useApi<{ readonly items: readonly Asset[] }>(paths.assets({ include_hidden: true }));
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const [pulling, setPulling] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<number | null>(null);
  const pullReady = useRef(false);
  const groups = transactions.data ? groupTransactions(transactions.data.items) : [];
  const categoryMap = new Map(
    (categories.data?.items ?? [])
      .flatMap((category) => [category, ...(category.children ?? [])])
      .map((category) => [category.id, category]),
  );
  const assetNames = new Map((assets.data?.items ?? []).map((asset) => [asset.id, asset.name]));

  const sync = async () => {
    setSyncing(true);
    setSyncError(false);
    try {
      const result = await api.runSync();
      if (result.errors.length > 0) throw new Error("import_failed");
      invalidate("transactions");
      transactions.reload();
    } catch {
      setSyncError(true);
    } finally {
      setSyncing(false);
    }
  };
  const syncRef = useRef(sync);
  syncRef.current = sync;

  useEffect(() => {
    if (!listReady) return;
    const root = rootRef.current;
    if (!root) return;
    const start = (event: TouchEvent) => {
      pullReady.current = false;
      touchStart.current =
        event.touches.length === 1 && window.scrollY === 0 ? (event.touches[0]?.clientY ?? null) : null;
    };
    const move = (event: TouchEvent) => {
      const startY = touchStart.current;
      const touch = event.touches[0];
      if (startY === null || !touch || window.scrollY !== 0) return;
      const distance = touch.clientY - startY;
      if (distance <= 0) {
        pullReady.current = false;
        setPulling(false);
        return;
      }
      event.preventDefault();
      pullReady.current = distance >= 72;
      setPulling(pullReady.current);
    };
    const finish = () => {
      if (touchStart.current !== null && pullReady.current) void syncRef.current();
      touchStart.current = null;
      pullReady.current = false;
      setPulling(false);
    };
    root.addEventListener("touchstart", start, { passive: true });
    root.addEventListener("touchmove", move, { passive: false });
    root.addEventListener("touchend", finish);
    root.addEventListener("touchcancel", finish);
    return () => {
      root.removeEventListener("touchstart", start);
      root.removeEventListener("touchmove", move);
      root.removeEventListener("touchend", finish);
      root.removeEventListener("touchcancel", finish);
    };
  }, [listReady]);

  if (transactions.data === undefined && transactions.loading) {
    return <Skeleton rows={5} label="이번 달 거래 불러오는 중" />;
  }
  if (transactions.data === undefined) {
    return (
      <EmptyState
        tone="error"
        title="거래를 불러오지 못했어요"
        action={
          <Button size="sm" onClick={transactions.reload}>
            다시 시도
          </Button>
        }
      />
    );
  }
  if (groups.length === 0) {
    return (
      <div className="daily-empty" ref={rootRef}>
        {syncError ? (
          <p className="daily-sync-error" role="alert">
            동기화를 완료하지 못했어요. 다시 시도해 주세요.
          </p>
        ) : null}
        {pulling ? (
          <p className="daily-pull-status" aria-live="polite">
            놓으면 동기화해요
          </p>
        ) : null}
        <EmptyState
          title="이번 달 기록이 없어요"
          description="첫 기록을 남기거나 은행 내역을 동기화해 보세요."
          action={
            <Button variant="primary" onClick={() => openEntry({ date: range.from })}>
              기록하기
            </Button>
          }
        />
        <Button icon={RefreshCw} disabled={syncing} onClick={() => void sync()}>
          {syncing ? "동기화 중" : "지금 동기화"}
        </Button>
      </div>
    );
  }

  return (
    <div className="daily-list" ref={rootRef}>
      {syncError ? (
        <p className="daily-sync-error" role="alert">
          동기화를 완료하지 못했어요. 다시 시도해 주세요.
        </p>
      ) : null}
      {pulling ? (
        <p className="daily-pull-status" aria-live="polite">
          놓으면 동기화해요
        </p>
      ) : null}
      <div className="daily-list-toolbar">
        <p>{transactions.data.items.length}건</p>
        <Button size="sm" icon={RefreshCw} disabled={syncing} onClick={() => void sync()}>
          {syncing ? "동기화 중" : "지금 동기화"}
        </Button>
      </div>
      {categories.error ? (
        <p className="daily-category-warning" role="status">
          분류 이름을 불러오지 못했어요.
        </p>
      ) : null}
      {groups.map((group) => (
        <DaySection key={group.date} group={group} categories={categoryMap} assets={assetNames} />
      ))}
      {transactions.offline ? (
        <p className="daily-offline" role="status">
          오프라인 저장 내역을 보고 있어요.
        </p>
      ) : null}
    </div>
  );
}
