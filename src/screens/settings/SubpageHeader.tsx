import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useMessages } from "../../i18n";
import { Link } from "../../router";
import { settingsMessages } from "./messages";
import "./settings.css";

/** Settings sub-screen title bar: back to 설정 on the left, the screen title centred (편한가계부 layout). */
export function SubpageHeader({ title, action }: { readonly title: string; readonly action?: ReactNode }) {
  const m = useMessages(settingsMessages);
  return (
    <header className="subpage-header">
      <Link to="/settings" className="sheet-back" aria-label={m.backToSettings}>
        <ChevronLeft size={22} aria-hidden="true" />
        <span aria-hidden="true">{m.settings}</span>
      </Link>
      <h1 className="subpage-title">{title}</h1>
      <span className="subpage-action">{action}</span>
    </header>
  );
}
