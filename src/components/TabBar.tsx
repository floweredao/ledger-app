import { Plus } from "lucide-react";
import { openEntry } from "../app/entry-bridge";
import { useMessages } from "../i18n";
import { common } from "../i18n/common";
import { Link, sectionUrl } from "../router";
import { ICON_STROKE_WIDTH } from "./Button";
import { componentMessages } from "./messages";
import { NAV_ITEMS, type Section } from "./nav";

function TabLink({ item, active }: { readonly item: (typeof NAV_ITEMS)[number]; readonly active: boolean }) {
  const Icon = item.icon;
  return (
    <li>
      <Link
        to={sectionUrl(item.section, item.to, active)}
        intent={active ? "fresh" : "return"}
        className="tab"
        aria-current={active ? "page" : undefined}
      >
        <span className="tab-icon">
          <Icon aria-hidden="true" size={22} strokeWidth={ICON_STROKE_WIDTH} />
        </span>
        <span className="tab-label">{item.label}</span>
      </Link>
    </li>
  );
}

export function TabBar({ active }: { readonly active: Section | null }) {
  const t = useMessages(componentMessages);
  const c = useMessages(common);

  return (
    <div className="tabbar">
      <div className="tabbar-controls">
        <nav aria-label={t.bottomNavigation}>
          <ul className="tabbar-list">
            {NAV_ITEMS.map((item) => (
              <TabLink key={item.section} item={item} active={active === item.section} />
            ))}
          </ul>
        </nav>
        <button type="button" className="tab tab-add" aria-label={c.record} onClick={() => openEntry()}>
          <span className="tab-add-circle">
            <Plus aria-hidden="true" size={24} strokeWidth={ICON_STROKE_WIDTH} />
          </span>
        </button>
      </div>
    </div>
  );
}
