import { useState } from "react";
import type { StatsTrend } from "../../../shared/schema";
import { useMessages } from "../../i18n";
import { formatMonth, formatMonthShort, formatWon } from "../../i18n/format";
import { chartMessages } from "./messages";

type Props = {
  readonly buckets: StatsTrend["buckets"];
  readonly type: "expense" | "income";
  readonly currentMonth: string;
};

const monthLabel = formatMonthShort;
const yearMonthLabel = formatMonth;
const signedAmount = (amount: number, type: Props["type"]) =>
  `${type === "income" && amount !== 0 ? "+" : type === "expense" && amount !== 0 ? "−" : ""}${formatWon(Math.abs(amount))}`;

export function Bars({ buckets, type, currentMonth }: Props) {
  const m = useMessages(chartMessages);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const amountFor = (bucket: StatsTrend["buckets"][number]) => bucket[type];
  const max = Math.max(0, ...buckets.map(amountFor));
  const selected =
    buckets.find((bucket) => bucket.month === selectedMonth) ?? buckets.find((bucket) => bucket.month === currentMonth);

  return (
    <div className="stats-bars">
      {selected ? (
        <p className="stats-bars-value num" aria-live="polite">
          {yearMonthLabel(selected.month)} · {signedAmount(amountFor(selected), type)}
        </p>
      ) : null}
      <div className="stats-bars-scroll">
        <div className="stats-bars-graphic">
          <svg
            className="stats-bars-svg"
            viewBox={`0 0 ${Math.max(360, buckets.length * 44)} 152`}
            role="img"
            aria-label={m.trendLabel}
          >
            {buckets.map((bucket, index) => {
              const x = 12 + index * 44;
              const value = amountFor(bucket);
              const height = max > 0 ? Math.max(3, (value / max) * 100) : 3;
              const y = 112 - height;
              const isCurrent = bucket.month === currentMonth;
              const isSelected = bucket.month === selectedMonth;
              return (
                <g key={bucket.month}>
                  <rect className="stats-bar-track" x={x} y="12" width="24" height="100" rx="8" />
                  <rect
                    className="stats-bar"
                    data-current={isCurrent || undefined}
                    data-selected={isSelected || undefined}
                    x={x}
                    y={y}
                    width="24"
                    height={height}
                    rx="8"
                  />
                  <text className="stats-bar-month" x={x + 12} y="137" textAnchor="middle">
                    {monthLabel(bucket.month)}
                  </text>
                </g>
              );
            })}
          </svg>
          <div className="stats-bars-controls">
            {buckets.map((bucket) => (
              <button
                className="stats-bar-control"
                key={bucket.month}
                type="button"
                aria-label={`${yearMonthLabel(bucket.month)} ${signedAmount(amountFor(bucket), type)}`}
                aria-pressed={bucket.month === selectedMonth}
                onFocus={() => setSelectedMonth(bucket.month)}
                onClick={() => setSelectedMonth(bucket.month)}
              />
            ))}
          </div>
        </div>
      </div>
      {buckets.length === 0 ? <p className="stats-chart-empty">{m.noTrend}</p> : null}
    </div>
  );
}
