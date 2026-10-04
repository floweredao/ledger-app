import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type Props = {
  readonly icon?: LucideIcon;
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly tone?: "neutral" | "error";
};

export function EmptyState({ icon: Icon, title, description, action, tone = "neutral" }: Props) {
  return (
    <div className="empty-state" data-tone={tone} role={tone === "error" ? "alert" : undefined}>
      {Icon ? <Icon aria-hidden="true" size={28} strokeWidth={1.75} className="empty-state-icon" /> : null}
      <p className="empty-state-title">{title}</p>
      {description ? <p className="empty-state-description">{description}</p> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}
