import { Plus } from "lucide-react";
import { useState } from "react";
import { formatDisplayDate } from "../../../shared/dates";
import { formatWon } from "../../../shared/money";
import type { AssetKind, AssetSummary } from "../../../shared/schema";
import { paths } from "../../api/client";
import { invalidate, useApi } from "../../api/hooks";
import { Button } from "../../components/Button";
import { CategoryIcon } from "../../components/CategoryIcon";
import { ListRow } from "../../components/ListRow";
import { OfflineBanner } from "../../components/OfflineBanner";
import { Skeleton } from "../../components/Skeleton";
import { AssetEditor } from "./AssetEditor";
import "./assets.css";

const KINDS: readonly AssetKind[] = ["cash", "bank", "check_card", "credit_card", "savings", "other", "loan"];
const LABELS = {
  cash: "현금",
  bank: "입출금",
  check_card: "체크카드",
  credit_card: "신용카드",
  savings: "저축",
  other: "기타",
  loan: "대출",
} as const;
const ICONS = {
  cash: "wallet",
  bank: "landmark",
  check_card: "credit-card",
  credit_card: "credit-card",
  savings: "piggy-bank",
  other: "package",
  loan: "hand-coins",
} as const;
export default function AssetsScreen() {
  const state = useApi<AssetSummary>(paths.assetsSummary);
  const [editorOpen, setEditorOpen] = useState(false);
  const summary = state.data;
  return (
    <div className="screen asset-screen">
      <header className="asset-header">
        <h1 className="screen-title">자산</h1>
        <Button variant="primary" icon={Plus} onClick={() => setEditorOpen(true)}>
          자산 추가
        </Button>
      </header>
      {state.offline && <OfflineBanner />}
      {!summary && state.error ? (
        <div className="asset-state" role="alert">
          <p>자산을 불러올 수 없어요</p>
          <Button onClick={state.reload}>다시 시도</Button>
        </div>
      ) : !summary ? (
        <Skeleton rows={3} />
      ) : summary.assets.length === 0 ? (
        <div className="asset-state">
          <p>기록한 자산이 없어요</p>
          <Button onClick={() => setEditorOpen(true)}>자산 추가하기</Button>
        </div>
      ) : (
        <>
          <dl className="asset-panel asset-totals">
            <div>
              <dt>자산</dt>
              <dd className="num">{formatWon(summary.totals.assets)}</dd>
            </div>
            <div>
              <dt>부채</dt>
              <dd className="num">{formatWon(summary.totals.debts)}</dd>
            </div>
            <div>
              <dt>순자산</dt>
              <dd className="num">{formatWon(summary.totals.net_worth)}</dd>
            </div>
          </dl>
          {KINDS.map((kind) => {
            const assets = summary.assets.filter((asset) => asset.kind === kind);
            if (!assets.length) return null;
            return (
              <section className="asset-section" key={kind}>
                <h2 className="asset-section-title">{LABELS[kind]}</h2>
                <div className="asset-list">
                  {assets.map((asset) => (
                    <div key={asset.id}>
                      <ListRow
                        leading={<CategoryIcon icon={ICONS[kind]} color="cat-8" />}
                        title={asset.name}
                        subtitle={
                          asset.reported_at
                            ? `${
                                asset.reported_balance !== null && asset.reported_balance !== asset.balance
                                  ? `은행 잔액 ${formatWon(asset.reported_balance)} · `
                                  : ""
                              }${formatDisplayDate(asset.reported_at)} 동기화`
                            : undefined
                        }
                        trailing={<span className="num">{formatWon(asset.balance)}</span>}
                        to={`/assets/${asset.id}`}
                      />
                      {asset.mismatch ? (
                        <p className="asset-warning">
                          잔액 차이: <span className="num">{formatWon(Math.abs(asset.mismatch))}</span>
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}
      <AssetEditor
        open={editorOpen}
        id={null}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          setEditorOpen(false);
          invalidate("assets");
        }}
      />
    </div>
  );
}
