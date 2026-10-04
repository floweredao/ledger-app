type Props = {
  readonly rows?: number;
  readonly variant?: "rows" | "block";
  readonly label?: string;
};

const ROW_KEYS = ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"] as const;

export function Skeleton({ rows = 3, variant = "rows", label = "불러오는 중" }: Props) {
  return (
    <div className="skeleton" data-variant={variant} aria-busy="true">
      <span className="sr-only">{label}</span>
      {variant === "block" ? (
        <span className="skeleton-block" aria-hidden="true" />
      ) : (
        ROW_KEYS.slice(0, rows).map((key) => (
          <span key={key} className="skeleton-row" aria-hidden="true">
            <span className="skeleton-circle" />
            <span className="skeleton-line" />
            <span className="skeleton-line skeleton-line-short" />
          </span>
        ))
      )}
    </div>
  );
}
