import { messages, useMessages } from "../../i18n";
import { common } from "../../i18n/common";
import { ledgerMessages } from "./messages";
import "./daily.css";
import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { kstDate } from "../../../shared/dates";
import type { Asset, Category, CategoryNode, Transaction } from "../../../shared/schema";
import { api, paths } from "../../api/client";
import { invalidate, useApi } from "../../api/hooks";
import { isPendingTransaction } from "../../api/outbox";
import { openEntry } from "../../app/entry-bridge";
import { calendarMonthFilter } from "../../app/periods";
import { categoryPath, TRANSFER_ICON, transferRoute } from "../../app/transaction-label";
import { AmountText } from "../../components/AmountText";
import { Button } from "../../components/Button";
import { CategoryIcon } from "../../components/CategoryIcon";
import { EmptyState } from "../../components/EmptyState";
import { Badge } from "../../components/ListRow";
import { Skeleton } from "../../components/Skeleton";
import { formatNumber, formatWeekday, formatWon } from "../../i18n/format";
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
  return messages(ledgerMessages).dayLabel(Number(date.slice(8, 10)), formatWeekday(date));
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
  const m = useMessages(ledgerMessages);
  const c = useMessages(common);
  const today = group.date === kstDate();
  const dayIncome = formatWon(group.income);
  // A refund-only day returned money: show it as +, never as a negative expense.
  const dayExpense = group.expense < 0 ? `+${formatWon(-group.expense)}` : formatWon(group.expense);
  return (
    <section className="daily-day" aria-label={dateLabel(group.date)}>
      <header className="daily-day-header">
        <h2 className="daily-day-date">
          <span className="daily-day-number num">{Number(group.date.slice(8, 10))}</span>
          <span className="daily-day-weekday" data-today={today || undefined}>
            {formatWeekday(group.date)}
          </span>
        </h2>
        <div className="daily-day-totals num">
          <span data-kind="income">
            <span className="sr-only">{m.dayTotal(c.income, dayIncome)}</span>
            <span aria-hidden="true">{dayIncome}</span>
          </span>
          <span data-kind="expense">
            <span className="sr-only">{m.dayTotal(c.expense, dayExpense)}</span>
            <span aria-hidden="true">{dayExpense}</span>
          </span>
        </div>
      </header>
      <div className="daily-day-rows">
        {group.transactions.map((transaction) => {
          const category = transaction.category_id ? categories.get(transaction.category_id) : undefined;
          const title = transaction.merchant.trim()
            ? transaction.merchant
            : transaction.type === "transfer"
              ? c.transfer
              : (category?.name ?? m.noCategory);
          const foreignAmount =
            transaction.currency !== "KRW" && transaction.foreign_amount !== null
              ? `${transaction.type === "expense" && !transaction.is_refund ? "-" : transaction.type === "transfer" ? "" : "+"}${transaction.currency} ${formatNumber(transaction.foreign_amount, { maximumFractionDigits: 4 })}`
              : null;
          const assetName = transaction.asset_id ? assets.get(transaction.asset_id) : undefined;
          const route = transferRoute(transaction, (id) => assets.get(id));
          const categoryLabel =
            transaction.type === "transfer"
              ? c.transfer
              : (categoryPath(transaction.category_id, (id) => categories.get(id)) ?? m.noCategory);
          const subtitle = [route ?? assetName ?? transaction.src_account ?? undefined, transaction.memo]
            .filter(Boolean)
            .join(" · ");
          const badges = (
            <span className="daily-badges">
              {isPendingTransaction(transaction.id) ? <Badge tone="accent">{m.pending}</Badge> : null}
              {AUTOMATIC_SOURCES.has(transaction.source) ? (
                <Badge>
                  <span className="daily-source-dot" aria-hidden="true" />
                  {m.automatic}
                </Badge>
              ) : null}
              {transaction.is_refund ? <Badge tone="accent">{c.refund}</Badge> : null}
              {transaction.krw_status === "pending" ? <Badge tone="warning">{m.pendingKrw}</Badge> : null}
            </span>
          );
          return (
            <button
              key={transaction.id}
              type="button"
              className="ledger-row"
              onClick={() => openEntry({ id: transaction.id })}
            >
              <span className="ledger-row-category">
                <CategoryIcon
                  size="sm"
                  icon={category?.icon ?? (transaction.type === "transfer" ? TRANSFER_ICON : undefined)}
                  color={category?.color}
                />
                <span className="ledger-row-category-name">{categoryLabel}</span>
              </span>
              <span className="ledger-row-text">
                <span className="ledger-row-title">{title}</span>
                <span className="ledger-row-subtitle">
                  {badges}
                  {subtitle}
                </span>
              </span>
              <span className="daily-row-amount">
                {transaction.krw_status === "pending" && transaction.amount === 0 && foreignAmount ? (
                  <span className="num">{foreignAmount}</span>
                ) : (
                  <>
                    <AmountText type={transaction.type} amount={transaction.amount} isRefund={transaction.is_refund} />
                    {foreignAmount ? <span className="daily-row-foreign num">{foreignAmount}</span> : null}
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default function DailyList() {
  const m = useMessages(ledgerMessages);
  const c = useMessages(common);

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
    return <Skeleton rows={5} label={m.loadingMonth} />;
  }
  if (transactions.data === undefined) {
    return (
      <EmptyState
        tone="error"
        title={m.loadTransactionsFailed}
        action={
          <Button size="sm" onClick={transactions.reload}>
            {c.retry}
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
            {m.syncFailed}
          </p>
        ) : null}
        {pulling ? (
          <p className="daily-pull-status" aria-live="polite">
            {m.releaseToSync}
          </p>
        ) : null}
        <EmptyState
          title={m.emptyMonth}
          description={m.emptyMonthHint}
          action={
            <Button variant="primary" onClick={() => openEntry({ date: range.from })}>
              {c.record}
            </Button>
          }
        />
        <Button icon={RefreshCw} disabled={syncing} onClick={() => void sync()}>
          {syncing ? m.syncing : c.syncNow}
        </Button>
      </div>
    );
  }

  return (
    <div className="daily-list" ref={rootRef}>
      {syncError ? (
        <p className="daily-sync-error" role="alert">
          {m.syncFailed}
        </p>
      ) : null}
      {pulling ? (
        <p className="daily-pull-status" aria-live="polite">
          {m.releaseToSync}
        </p>
      ) : null}
      <div className="daily-list-toolbar">
        <p>{c.count(transactions.data.items.length)}</p>
        <Button size="sm" icon={RefreshCw} disabled={syncing} onClick={() => void sync()}>
          {syncing ? m.syncing : c.syncNow}
        </Button>
      </div>
      {categories.error ? (
        <p className="daily-category-warning" role="status">
          {m.loadCategoriesFailed}
        </p>
      ) : null}
      {groups.map((group) => (
        <DaySection key={group.date} group={group} categories={categoryMap} assets={assetNames} />
      ))}
      {transactions.offline ? (
        <p className="daily-offline" role="status">
          {m.offlineRecords}
        </p>
      ) : null}
    </div>
  );
}
