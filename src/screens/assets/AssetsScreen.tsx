import { Plus } from "lucide-react";
import { useState } from "react";
import type { AssetKind, AssetSummary } from "../../../shared/schema";
import { paths } from "../../api/client";
import { invalidate, useApi } from "../../api/hooks";
import { Button } from "../../components/Button";
import { CategoryIcon } from "../../components/CategoryIcon";
import { ListRow } from "../../components/ListRow";
import { OfflineBanner } from "../../components/OfflineBanner";
import { Skeleton } from "../../components/Skeleton";
import { useMessages } from "../../i18n";
import { common } from "../../i18n/common";
import { formatDisplayDate, formatWon } from "../../i18n/format";
import { AssetEditor } from "./AssetEditor";
import { assetsMessages } from "./messages";
import "./assets.css";

const KINDS: readonly AssetKind[] = ["cash", "bank", "check_card", "credit_card", "savings", "other", "loan"];
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
  const m = useMessages(assetsMessages);
  const c = useMessages(common);
  const LABELS = {
    cash: m.cash,
    bank: m.bank,
    check_card: m.checkCard,
    credit_card: m.creditCard,
    savings: m.savings,
    other: m.other,
    loan: m.loan,
  } as const;

  const state = useApi<AssetSummary>(paths.assetsSummary);
  const [editorOpen, setEditorOpen] = useState(false);
  const summary = state.data;
  return (
    <div className="screen asset-screen">
      <header className="asset-header">
        <span aria-hidden="true" />
        <h1 className="asset-title">{m.assets}</h1>
        <Button variant="ghost" icon={Plus} aria-label={m.addAsset} onClick={() => setEditorOpen(true)} />
      </header>
      {state.offline && <OfflineBanner />}
      {!summary && state.error ? (
        <div className="asset-state" role="alert">
          <p>{m.loadAssetsFailed}</p>
          <Button onClick={state.reload}>{c.retry}</Button>
        </div>
      ) : !summary ? (
        <Skeleton rows={3} label={m.loading} />
      ) : summary.assets.length === 0 ? (
        <div className="asset-state">
          <p>{m.emptyAssets}</p>
          <Button onClick={() => setEditorOpen(true)}>{m.addFirstAsset}</Button>
        </div>
      ) : (
        <>
          <dl className="asset-panel asset-totals">
            <div>
              <dt>{m.assets}</dt>
              <dd className="num">{formatWon(summary.totals.assets)}</dd>
            </div>
            <div>
              <dt>{m.debts}</dt>
              <dd className="num" data-kind="debt">
                {formatWon(summary.totals.debts)}
              </dd>
            </div>
            <div>
              <dt>{m.netWorth}</dt>
              <dd className="num">{formatWon(summary.totals.net_worth)}</dd>
            </div>
          </dl>
          {KINDS.map((kind) => {
            const assets = summary.assets.filter((asset) => asset.kind === kind);
            if (!assets.length) return null;
            return (
              <section className="asset-section" key={kind}>
                <h2 className="asset-section-title">
                  <span>{LABELS[kind]}</span>
                  <span className="num">{formatWon(assets.reduce((sum, asset) => sum + asset.balance, 0))}</span>
                </h2>
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
                                  ? m.bankBalance(formatWon(asset.reported_balance))
                                  : ""
                              }${m.syncedAt(formatDisplayDate(asset.reported_at))}`
                            : undefined
                        }
                        trailing={<span className="num">{formatWon(asset.balance)}</span>}
                        to={`/assets/${asset.id}`}
                      />
                      {asset.mismatch ? (
                        <p className="asset-warning">
                          {m.balanceDifference} <span className="num">{formatWon(Math.abs(asset.mismatch))}</span>
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
