import type { AssetSummary } from "../../../shared/schema";
import { useMessages } from "../../i18n";
import { formatDisplayDate, formatNumber, formatWon } from "../../i18n/format";
import { assetsMessages } from "./messages";
import "./assets.css";

export type AssetSummaryRow = AssetSummary["assets"][number];
export function CardStatement({ asset }: { readonly asset: AssetSummaryRow }) {
  const m = useMessages(assetsMessages);

  if (asset.kind !== "credit_card" && asset.kind !== "check_card") return null;
  return (
    <section className="asset-section">
      <h2 className="asset-section-title">{m.cardInformation}</h2>
      <dl className="asset-panel asset-metrics">
        <div>
          <dt>{m.usagePeriod}</dt>
          <dd>
            {asset.cycle ? `${formatDisplayDate(asset.cycle.from)} ~ ${formatDisplayDate(asset.cycle.to)}` : m.noPeriod}
          </dd>
        </div>
        <div>
          <dt>{m.cycleSpending}</dt>
          <dd className="num">{formatWon(asset.usage ?? 0)}</dd>
        </div>
        {asset.kind === "credit_card" && (
          <>
            <div>
              <dt>{m.paymentDay}</dt>
              <dd>{asset.payment_date ? formatDisplayDate(asset.payment_date) : m.noPaymentDate}</dd>
            </div>
            <div>
              <dt>{m.expectedPayment}</dt>
              <dd className="num">{formatWon(asset.expected_payment ?? 0)}</dd>
            </div>
          </>
        )}
        {asset.performance && (
          <div className="asset-performance">
            <dt>{m.spendingTarget}</dt>
            <dd className="num">
              {formatWon(asset.performance.achieved)} / {formatWon(asset.performance.target)} ·{" "}
              {formatNumber(Math.round(asset.performance.pct))}%
            </dd>
            <div
              role="progressbar"
              aria-label={m.cardPerformance}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(100, Math.max(0, asset.performance.pct))}
              className="asset-progress"
            >
              <div style={{ width: `${Math.min(100, Math.max(0, asset.performance.pct))}%` }} />
            </div>
          </div>
        )}
      </dl>
    </section>
  );
}
