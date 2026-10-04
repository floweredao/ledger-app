import type { ReactNode } from "react";
import { Link } from "../router";

type ListRowProps = {
  readonly leading?: ReactNode;
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly trailing?: ReactNode;
  readonly badges?: ReactNode;
  readonly onClick?: () => void;
  readonly to?: string;
};

export function ListRow({ leading, title, subtitle, trailing, badges, onClick, to }: ListRowProps) {
  const content = (
    <>
      {leading ? <span className="list-row-leading">{leading}</span> : null}
      <span className="list-row-text">
        <span className="list-row-title">{title}</span>
        {subtitle || badges ? (
          <span className="list-row-subtitle">
            {badges}
            {subtitle}
          </span>
        ) : null}
      </span>
      {trailing ? <span className="list-row-trailing">{trailing}</span> : null}
    </>
  );
  if (to) {
    return (
      <Link to={to} className="list-row list-row-interactive">
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" className="list-row list-row-interactive" onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div className="list-row">{content}</div>;
}

export function Badge({
  children,
  tone = "neutral",
}: {
  readonly children: ReactNode;
  readonly tone?: "neutral" | "warning" | "accent";
}) {
  return (
    <span className="badge" data-tone={tone}>
      {children}
    </span>
  );
}
