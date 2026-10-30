import { ArrowLeft, Trash2 } from "lucide-react";
import { useState } from "react";
import { kstDate } from "../../../shared/dates";
import type { AssetSummary, Category, CategoryNode, Transaction, TransactionList } from "../../../shared/schema";
import { api, isApiError, paths } from "../../api/client";
import { invalidate, useApi } from "../../api/hooks";
import { openEntry } from "../../app/entry-bridge";
import { rowCategoryLabel } from "../../app/transaction-label";
import { AmountText } from "../../components/AmountText";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/Dialog";
import { Badge, ListRow } from "../../components/ListRow";
import { OfflineBanner } from "../../components/OfflineBanner";
import { Skeleton } from "../../components/Skeleton";
import { toast } from "../../components/Toast";
import { TransactionContinuation } from "../../components/TransactionContinuation";
import { useMessages } from "../../i18n";
import { common } from "../../i18n/common";
import { formatDisplayDate, formatNumber, formatWon } from "../../i18n/format";
import { navigate } from "../../router";
import { AssetEditor } from "./AssetEditor";
import { CardStatement } from "./CardStatement";
import { assetsMessages } from "./messages";
import { runningBalances } from "./running-balance";
import "./assets.css";

function AssetTransactions({
  items,
  balances,
}: {
  readonly items: readonly Transaction[];
  /** Balance right after each record, when known (the first page). */
  readonly balances?: ReadonlyMap<string, number>;
}) {
  const m = useMessages(assetsMessages);
  const c = useMessages(common);
  const categories = useApi<{ readonly items: readonly CategoryNode[] }>(paths.categories({ include_hidden: true }));
  const categoryMap = new Map<string, Category>(
    (categories.data?.items ?? [])
      .flatMap((category) => [category, ...(category.children ?? [])])
      .map((category) => [category.id, category]),
  );
  const grouped = new Map<string, Transaction[]>();
  for (const item of items) {
    const date = kstDate(item.occurred_at);
    const group = grouped.get(date) ?? [];
    group.push(item);
    grouped.set(date, group);
  }
  return Array.from(grouped)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, rows]) => (
      <section className="asset-section" key={date}>
        <h3 className="asset-meta">{formatDisplayDate(date)}</h3>
        <div className="asset-list">
          {rows.map((item) => {
            const foreignAmount =
              item.currency !== "KRW" && item.foreign_amount !== null
                ? `${item.type === "expense" && !item.is_refund ? "-" : item.type === "transfer" ? "" : "+"}${item.currency} ${formatNumber(item.foreign_amount, { maximumFractionDigits: 4 })}`
                : null;
            const title = item.merchant || c.transfer;
            const categoryLabel = rowCategoryLabel(item.category_id, (id) => categoryMap.get(id), title);
            // A one-sided transfer is a balance adjustment; say which way it moved, since transfers carry no sign.
            const adjustment =
              item.type === "transfer" && (item.asset_id === null || item.to_asset_id === null)
                ? item.asset_id === null
                  ? m.adjustmentUp
                  : m.adjustmentDown
                : null;
            return (
              <ListRow
                key={item.id}
                title={title}
                subtitle={
                  [adjustment, categoryLabel, item.memo, item.krw_status !== "pending" ? foreignAmount : null]
                    .filter(Boolean)
                    .join(" · ") || undefined
                }
                badges={
                  <>
                    {item.is_refund ? <Badge tone="accent">{c.refund}</Badge> : null}
                    {item.krw_status === "pending" ? <Badge tone="warning">{m.pendingKrw}</Badge> : null}
                  </>
                }
                trailing={
                  <span className="asset-row-amount">
                    {item.krw_status === "pending" && item.amount === 0 && foreignAmount ? (
                      <span className="num">{foreignAmount}</span>
                    ) : (
                      <AmountText type={item.type} amount={item.amount} isRefund={item.is_refund} />
                    )}
                    {balances?.has(item.id) ? (
                      <span className="asset-row-balance num">
                        {m.balanceAfter(formatWon(balances.get(item.id) ?? 0))}
                      </span>
                    ) : null}
                  </span>
                }
                onClick={() => openEntry({ id: item.id })}
              />
            );
          })}
        </div>
      </section>
    ));
}

export default function AssetDetail({ id }: { readonly id: string }) {
  const m = useMessages(assetsMessages);
  const c = useMessages(common);

  const summary = useApi<AssetSummary>(`${paths.assetsSummary}?include_hidden=true`);
  const tx = useApi<TransactionList>(paths.transactions({ asset_id: id }));
  const [editorOpen, setEditorOpen] = useState(false);
  const [confirm, setConfirm] = useState<"delete" | "payment" | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [referenced, setReferenced] = useState(false);
  const asset = summary.data?.assets.find((item) => item.id === id);
  const refresh = () => {
    for (const prefix of ["assets", "transactions", "stats", "budgets"]) invalidate(prefix);
  };
  const remove = async (hide = false) => {
    setBusy(true);
    setFailure("");
    try {
      if (hide) await api.patchAsset(id, { hidden: true });
      else await api.deleteAsset(id);
      refresh();
      toast({ message: hide ? m.assetHidden : m.assetDeleted });
      navigate("/assets", { replace: true });
    } catch (error) {
      if (isApiError(error) && error.code === "in_use") setReferenced(true);
      else setFailure(m.deleteFailed);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  const pay = async () => {
    setBusy(true);
    setFailure("");
    try {
      await api.cardPayment(id);
      refresh();
      toast({ message: m.cardPaid });
    } catch {
      setFailure(m.paymentFailed);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  if (!summary.data && summary.error)
    return (
      <div className="screen asset-state" role="alert">
        <h1 className="screen-title">{m.loadAssetsFailed}</h1>
        <Button onClick={summary.reload}>{c.retry}</Button>
        <Button onClick={() => navigate("/assets")}>{m.back}</Button>
      </div>
    );
  if (!summary.data && summary.loading)
    return (
      <div className="screen">
        <Skeleton rows={3} label={m.loading} />
      </div>
    );
  if (!asset)
    return (
      <div className="screen asset-state">
        <h1 className="screen-title">{m.assetMissing}</h1>
        <Button onClick={() => navigate("/assets")}>{m.back}</Button>
      </div>
    );
  const linked = summary.data?.assets.find((item) => item.id === asset.linked_asset_id);
  const baseline = asset.kind === "check_card" ? linked?.opening_date : asset.opening_date;
  // A check card's list holds only its own records, so the account's running balance cannot be rebuilt from it.
  const balances =
    asset.kind === "check_card" || !tx.data
      ? undefined
      : runningBalances({
          balance: asset.balance,
          accountIds: new Set([
            asset.id,
            ...(summary.data?.assets ?? [])
              .filter((item) => item.kind === "check_card" && item.linked_asset_id === asset.id)
              .map((item) => item.id),
          ]),
          openingDate: asset.opening_date ?? null,
          items: tx.data.items,
        });
  return (
    <div className="screen asset-screen">
      <header className="asset-header">
        <Button variant="ghost" icon={ArrowLeft} aria-label={m.assetList} onClick={() => navigate("/assets")} />
        <h1 className="screen-title">{asset.name}</h1>
        <Button onClick={() => setEditorOpen(true)}>{m.editAssetAction}</Button>
      </header>
      {summary.offline && <OfflineBanner />}
      <div className="asset-panel">
        <p className="asset-meta">
          {m.currentBalance}
          {asset.hidden ? m.hiddenSuffix : ""}
        </p>
        <p className="asset-balance num">{formatWon(asset.balance)}</p>
        {baseline && (
          <p className="asset-meta">
            {m.balanceDate} {formatDisplayDate(baseline)} (KST)
          </p>
        )}
      </div>
      <CardStatement asset={asset} />
      {asset.kind === "credit_card" && (
        <section className="asset-section asset-panel">
          {linked ? (
            <p>
              {m.linkedAccountPrefix} {linked.name} · <span className="num">{formatWon(linked.balance)}</span>
            </p>
          ) : (
            <p className="asset-error">{m.missingPaymentAccount}</p>
          )}
          <Button
            variant="primary"
            disabled={busy || !linked || (asset.expected_payment ?? 0) <= 0}
            onClick={() => setConfirm("payment")}
          >
            {m.payCard}
          </Button>
        </section>
      )}
      {failure && (
        <p className="asset-error" role="alert">
          {failure}
        </p>
      )}
      <section className="asset-section">
        <h2 className="asset-section-title">{m.transactions}</h2>
        {tx.error && !tx.data ? (
          <div role="alert" className="asset-state">
            <p>{m.loadTransactionsFailed}</p>
            <Button onClick={tx.reload}>{c.retry}</Button>
          </div>
        ) : !tx.data ? (
          <Skeleton rows={3} label={m.loading} />
        ) : !tx.data.items.length ? (
          <p className="asset-state">{m.emptyTransactions}</p>
        ) : (
          <>
            <AssetTransactions items={tx.data.items} {...(balances ? { balances } : {})} />
            <TransactionContinuation
              key={`${id}:${tx.data.next_cursor}`}
              query={{ asset_id: id }}
              cursor={tx.data.next_cursor}
              seenIds={tx.data.items.map((item) => item.id)}
              renderRows={(items) => <AssetTransactions items={items} />}
            />
          </>
        )}
      </section>
      {referenced && (
        <div className="asset-panel">
          <p>{m.assetInUse}</p>
          <Button disabled={busy} onClick={() => void remove(true)}>
            {m.hide}
          </Button>
        </div>
      )}
      <Button variant="danger" icon={Trash2} disabled={busy} onClick={() => setConfirm("delete")}>
        {c.delete}
      </Button>
      <ConfirmDialog
        open={confirm === "delete"}
        title={m.deleteAsset}
        description={m.deleteDescription(asset.name)}
        confirmLabel={c.delete}
        destructive
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void remove()}
      />
      <ConfirmDialog
        open={confirm === "payment"}
        title={m.payCard}
        description={m.paymentDescription(linked?.name ?? "", formatWon(asset.expected_payment ?? 0))}
        confirmLabel={m.pay}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void pay()}
      />
      <AssetEditor
        open={editorOpen}
        id={id}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          setEditorOpen(false);
          refresh();
        }}
      />
    </div>
  );
}
