import { useMessages } from "../i18n";
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

/** Destinations only (DESIGN.md IA); recording is the separate floating button in AppShell. */
export function TabBar({ active }: { readonly active: Section | null }) {
  const t = useMessages(componentMessages);
  return (
    <div className="tabbar">
      <nav aria-label={t.bottomNavigation}>
        <ul className="tabbar-list">
          {NAV_ITEMS.map((item) => (
            <TabLink key={item.section} item={item} active={active === item.section} />
          ))}
        </ul>
      </nav>
    </div>
  );
}
