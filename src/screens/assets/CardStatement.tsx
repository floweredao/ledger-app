import { formatDisplayDate } from "../../../shared/dates";
import { formatWon } from "../../../shared/money";
import type { AssetSummary } from "../../../shared/schema";
import "./assets.css";

export type AssetSummaryRow = AssetSummary["assets"][number];
export function CardStatement({ asset }: { readonly asset: AssetSummaryRow }) {
  if (asset.kind !== "credit_card" && asset.kind !== "check_card") return null;
  return (
    <section className="asset-section">
      <h2 className="asset-section-title">카드 정보</h2>
      <dl className="asset-panel asset-metrics">
        <div>
          <dt>사용 기간</dt>
          <dd>
            {asset.cycle
              ? `${formatDisplayDate(asset.cycle.from)} ~ ${formatDisplayDate(asset.cycle.to)}`
              : "기간 없음"}
          </dd>
        </div>
        <div>
          <dt>이번 주기 사용액</dt>
          <dd className="num">{formatWon(asset.usage ?? 0)}</dd>
        </div>
        {asset.kind === "credit_card" && (
          <>
            <div>
              <dt>결제일</dt>
              <dd>{asset.payment_date ? formatDisplayDate(asset.payment_date) : "결제일 없음"}</dd>
            </div>
            <div>
              <dt>결제 예정액</dt>
              <dd className="num">{formatWon(asset.expected_payment ?? 0)}</dd>
            </div>
          </>
        )}
        {asset.performance && (
          <div className="asset-performance">
            <dt>실적 목표</dt>
            <dd className="num">
              {formatWon(asset.performance.achieved)} / {formatWon(asset.performance.target)} ·{" "}
              {Math.round(asset.performance.pct)}%
            </dd>
            <div
              role="progressbar"
              aria-label="카드 실적"
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
