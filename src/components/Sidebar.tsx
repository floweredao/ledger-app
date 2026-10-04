import { Plus } from "lucide-react";
import { openEntry } from "../app/entry-bridge";
import { Link } from "../router";
import { Button } from "./Button";
import { NAV_ITEMS, type Section } from "./nav";

export function Sidebar({ active }: { readonly active: Section | null }) {
  return (
    <nav className="sidebar" aria-label="사이드 메뉴">
      <p className="sidebar-brand">가계부</p>
      <Button variant="primary" icon={Plus} block onClick={() => openEntry()}>
        기록하기
      </Button>
      <ul className="sidebar-list">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const current = active === item.section;
          return (
            <li key={item.section}>
              <Link to={item.to} className="sidebar-link" aria-current={current ? "page" : undefined}>
                <Icon aria-hidden="true" size={20} strokeWidth={current ? 2.25 : 1.75} />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
