import { Plus } from "lucide-react";
import { openEntry } from "../app/entry-bridge";
import { Link } from "../router";
import { NAV_ITEMS, type Section } from "./nav";

function TabLink({ item, active }: { readonly item: (typeof NAV_ITEMS)[number]; readonly active: boolean }) {
  const Icon = item.icon;
  return (
    <li>
      <Link to={item.to} className="tab" aria-current={active ? "page" : undefined}>
        <span className="tab-icon">
          <Icon aria-hidden="true" size={22} strokeWidth={active ? 2.25 : 1.75} />
        </span>
        <span className="tab-label">{item.label}</span>
      </Link>
    </li>
  );
}

export function TabBar({ active }: { readonly active: Section | null }) {
  const [first, second, third, fourth] = NAV_ITEMS;
  return (
    <nav className="tabbar" aria-label="하단 메뉴">
      <ul className="tabbar-list">
        {first ? <TabLink item={first} active={active === first.section} /> : null}
        {second ? <TabLink item={second} active={active === second.section} /> : null}
        <li>
          <button type="button" className="tab tab-add" aria-label="기록하기" onClick={() => openEntry()}>
            <span className="tab-add-circle">
              <Plus aria-hidden="true" size={24} strokeWidth={2.5} />
            </span>
          </button>
        </li>
        {third ? <TabLink item={third} active={active === third.section} /> : null}
        {fourth ? <TabLink item={fourth} active={active === fourth.section} /> : null}
      </ul>
    </nav>
  );
}
