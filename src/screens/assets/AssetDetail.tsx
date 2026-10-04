import { ArrowLeft, Trash2 } from "lucide-react";
import { useState } from "react";
import { formatDisplayDate, kstDate } from "../../../shared/dates";
import { formatWon } from "../../../shared/money";
import type { AssetSummary, Transaction, TransactionList } from "../../../shared/schema";
import { api, isApiError, paths } from "../../api/client";
import { invalidate, useApi } from "../../api/hooks";
import { openEntry } from "../../app/entry-bridge";
import { AmountText } from "../../components/AmountText";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/Dialog";
import { Badge, ListRow } from "../../components/ListRow";
import { OfflineBanner } from "../../components/OfflineBanner";
import { Skeleton } from "../../components/Skeleton";
import { toast } from "../../components/Toast";
import { TransactionContinuation } from "../../components/TransactionContinuation";
import { navigate } from "../../router";
import { AssetEditor } from "./AssetEditor";
import { CardStatement } from "./CardStatement";
import "./assets.css";

function AssetTransactions({ items }: { readonly items: readonly Transaction[] }) {
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
                ? `${item.type === "expense" && !item.is_refund ? "-" : item.type === "transfer" ? "" : "+"}${item.currency} ${item.foreign_amount.toLocaleString("ko-KR", { maximumFractionDigits: 4 })}`
                : null;
            return (
              <ListRow
                key={item.id}
                title={item.merchant || "이체"}
                subtitle={
                  [item.memo, item.krw_status !== "pending" ? foreignAmount : null].filter(Boolean).join(" · ") ||
                  undefined
                }
                badges={
                  <>
                    {item.is_refund ? <Badge tone="accent">환불</Badge> : null}
                    {item.krw_status === "pending" ? <Badge tone="warning">원화 미확정</Badge> : null}
                  </>
                }
                trailing={
                  item.krw_status === "pending" && item.amount === 0 && foreignAmount ? (
                    <span className="num">{foreignAmount}</span>
                  ) : (
                    <AmountText type={item.type} amount={item.amount} isRefund={item.is_refund} />
                  )
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
      toast({ message: hide ? "자산을 숨겼어요" : "자산이 삭제되었어요" });
      navigate("/assets", { replace: true });
    } catch (error) {
      if (isApiError(error) && error.code === "in_use") setReferenced(true);
      else setFailure(error instanceof Error ? error.message : "삭제에 실패했어요");
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
      toast({ message: "카드 대금을 결제했어요" });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "결제에 실패했어요");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  if (!summary.data && summary.error)
    return (
      <div className="screen asset-state" role="alert">
        <h1 className="screen-title">자산을 불러올 수 없어요</h1>
        <Button onClick={summary.reload}>다시 시도</Button>
        <Button onClick={() => navigate("/assets")}>돌아가기</Button>
      </div>
    );
  if (!summary.data && summary.loading)
    return (
      <div className="screen">
        <Skeleton rows={3} />
      </div>
    );
  if (!asset)
    return (
      <div className="screen asset-state">
        <h1 className="screen-title">자산을 찾을 수 없어요</h1>
        <Button onClick={() => navigate("/assets")}>돌아가기</Button>
      </div>
    );
  const linked = summary.data?.assets.find((item) => item.id === asset.linked_asset_id);
  const baseline = asset.kind === "check_card" ? linked?.opening_date : asset.opening_date;
  return (
    <div className="screen asset-screen">
      <header className="asset-header">
        <Button variant="ghost" icon={ArrowLeft} aria-label="자산 목록" onClick={() => navigate("/assets")} />
        <h1 className="screen-title">{asset.name}</h1>
        <Button onClick={() => setEditorOpen(true)}>편집</Button>
      </header>
      {summary.offline && <OfflineBanner />}
      <div className="asset-panel">
        <p className="asset-meta">현재 잔액{asset.hidden ? " · 숨김" : ""}</p>
        <p className="asset-balance num">{formatWon(asset.balance)}</p>
        {baseline && <p className="asset-meta">잔액 기준일 · {formatDisplayDate(baseline)} (KST)</p>}
      </div>
      <CardStatement asset={asset} />
      {asset.kind === "credit_card" && (
        <section className="asset-section asset-panel">
          {linked ? (
            <p>
              연결 계좌: {linked.name} · <span className="num">{formatWon(linked.balance)}</span>
            </p>
          ) : (
            <p className="asset-error">결제할 연결 계좌가 없어요. 편집에서 계좌를 선택해주세요.</p>
          )}
          <Button
            variant="primary"
            disabled={busy || !linked || (asset.expected_payment ?? 0) <= 0}
            onClick={() => setConfirm("payment")}
          >
            카드 대금 결제
          </Button>
        </section>
      )}
      {failure && (
        <p className="asset-error" role="alert">
          {failure}
        </p>
      )}
      <section className="asset-section">
        <h2 className="asset-section-title">거래 내역</h2>
        {tx.error && !tx.data ? (
          <div role="alert" className="asset-state">
            <p>거래를 불러올 수 없어요</p>
            <Button onClick={tx.reload}>다시 시도</Button>
          </div>
        ) : !tx.data ? (
          <Skeleton rows={3} />
        ) : !tx.data.items.length ? (
          <p className="asset-state">거래 내역이 없어요</p>
        ) : (
          <>
            <AssetTransactions items={tx.data.items} />
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
          <p>거래 또는 카드가 참조하는 자산은 삭제할 수 없어요. 대신 숨길까요?</p>
          <Button disabled={busy} onClick={() => void remove(true)}>
            숨기기
          </Button>
        </div>
      )}
      <Button variant="danger" icon={Trash2} disabled={busy} onClick={() => setConfirm("delete")}>
        삭제
      </Button>
      <ConfirmDialog
        open={confirm === "delete"}
        title="자산 삭제"
        description={`${asset.name}을(를) 삭제할까요?`}
        confirmLabel="삭제"
        destructive
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void remove()}
      />
      <ConfirmDialog
        open={confirm === "payment"}
        title="카드 대금 결제"
        description={`${linked?.name ?? ""}에서 ${formatWon(asset.expected_payment ?? 0)}을 결제할까요?`}
        confirmLabel="결제"
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
