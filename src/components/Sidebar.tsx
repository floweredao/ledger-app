import { Plus } from "lucide-react";
import { openEntry } from "../app/entry-bridge";
import { useMessages } from "../i18n";
import { common } from "../i18n/common";
import { Link, sectionUrl } from "../router";
import { Button, ICON_STROKE_WIDTH } from "./Button";
import { componentMessages } from "./messages";
import { NAV_ITEMS, type Section } from "./nav";

export function Sidebar({ active }: { readonly active: Section | null }) {
  const t = useMessages(componentMessages);
  const c = useMessages(common);

  return (
    <aside className="sidebar">
      <p className="sidebar-brand">{c.appName}</p>
      <Button variant="primary" icon={Plus} block onClick={() => openEntry()}>
        {c.record}
      </Button>
      <nav aria-label={t.sidebarNavigation}>
        <ul className="sidebar-list">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const current = active === item.section;
            return (
              <li key={item.section}>
                <Link
                  to={sectionUrl(item.section, item.to, current)}
                  intent={current ? "fresh" : "return"}
                  className="sidebar-link"
                  aria-current={current ? "page" : undefined}
                >
                  <Icon aria-hidden="true" size={20} strokeWidth={ICON_STROKE_WIDTH} />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
