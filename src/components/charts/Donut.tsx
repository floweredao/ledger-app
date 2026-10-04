import type { StatsCategories } from "../../../shared/schema";
import { categoryColor } from "../CategoryIcon";

export type DonutRow = StatsCategories["rows"][number] | StatsCategories["rows"][number]["children"][number];

type Props = {
  readonly rows: readonly DonutRow[];
  readonly total: number;
  readonly type: "expense" | "income";
  readonly deltas?: ReadonlyMap<string, number>;
  readonly onSelect: (row: DonutRow) => void;
};

export function calculateArcAngles(values: readonly number[]): readonly number[] {
  const positiveTotal = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (positiveTotal === 0) return values.map(() => 0);
  let used = 0;
  return values.map((value, index) => {
    if (index === values.length - 1) return 360 - used;
    const angle = (Math.max(0, value) / positiveTotal) * 360;
    used += angle;
    return angle;
  });
}

function signedAmount(amount: number, type: Props["type"]): string {
  const signed = type === "expense" ? -amount : amount;
  return `${signed > 0 ? "+" : signed < 0 ? "−" : ""}${Math.abs(signed).toLocaleString("ko-KR")}원`;
}

function deltaLabel(delta: number | undefined): string | null {
  if (delta === undefined) return null;
  return `지난 기간보다 ${delta > 0 ? "+" : delta < 0 ? "−" : ""}${Math.abs(delta).toLocaleString("ko-KR")}원`;
}

export function Donut({ rows, total, type, deltas = new Map(), onSelect }: Props) {
  const visibleRows = rows.filter((row) => row.amount > 0);
  const angles = calculateArcAngles(visibleRows.map((row) => row.amount));
  const circumference = 2 * Math.PI * 72;
  let offset = 0;

  return (
    <div className="stats-donut">
      <div className="stats-donut-chart">
        <svg
          className="stats-donut-svg"
          viewBox="0 0 200 200"
          role="img"
          aria-label={`분류별 합계 ${signedAmount(total, type)}`}
        >
          <circle className="stats-donut-track" cx="100" cy="100" r="72" />
          {visibleRows.map((row, index) => {
            const angle = angles[index] ?? 0;
            const length = (angle / 360) * circumference;
            const segmentOffset = offset;
            offset += length;
            return (
              <circle
                key={row.category_id ?? row.name}
                cx="100"
                cy="100"
                r="72"
                stroke={categoryColor(row.color)}
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-segmentOffset}
                transform="rotate(-90 100 100)"
              />
            );
          })}
        </svg>
        <div className="stats-donut-total">
          <span>합계</span>
          <strong className="num">{signedAmount(total, type)}</strong>
        </div>
      </div>
      <ul className="stats-ranked-list" aria-label="분류별 금액과 비율">
        {rows.map((row) => {
          const delta = row.category_id ? deltas.get(row.category_id) : undefined;
          const pct = total === 0 ? 0 : (row.amount / total) * 100;
          return (
            <li key={row.category_id ?? row.name}>
              <button
                className="stats-ranked-row"
                type="button"
                onClick={() => onSelect(row)}
                aria-label={`${row.name}, ${signedAmount(row.amount, type)}, ${pct.toFixed(1)}퍼센트${deltaLabel(delta) ? `, ${deltaLabel(delta)}` : ""}`}
              >
                <span className="stats-category-mark" style={{ backgroundColor: categoryColor(row.color) }} />
                <span className="stats-ranked-copy">
                  <span className="stats-ranked-name">{row.name}</span>
                  <span className="stats-ranked-meta num">
                    {pct.toFixed(1)}%{deltaLabel(delta) ? ` · ${deltaLabel(delta)}` : ""}
                  </span>
                </span>
                <strong className="stats-ranked-amount num">{signedAmount(row.amount, type)}</strong>
              </button>
            </li>
          );
        })}
      </ul>
      {rows.length === 0 ? <p className="stats-chart-empty">표시할 분류가 없어요</p> : null}
    </div>
  );
}
