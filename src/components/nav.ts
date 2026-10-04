import { BookOpen, ChartPie, type LucideIcon, Settings, Wallet } from "lucide-react";
import type { RouteName } from "../router";

export type Section = "ledger" | "stats" | "assets" | "settings";

export const NAV_ITEMS: readonly { section: Section; to: string; label: string; icon: LucideIcon }[] = [
  { section: "ledger", to: "/", label: "가계부", icon: BookOpen },
  { section: "stats", to: "/stats", label: "통계", icon: ChartPie },
  { section: "assets", to: "/assets", label: "자산", icon: Wallet },
  { section: "settings", to: "/settings", label: "설정", icon: Settings },
];

export function sectionOf(route: RouteName): Section | null {
  switch (route) {
    case "ledger":
    case "calendar":
    case "monthly":
    case "search":
      return "ledger";
    case "stats":
    case "budget":
      return "stats";
    case "assets":
    case "asset-detail":
      return "assets";
    case "settings":
    case "settings-categories":
    case "settings-rules":
    case "settings-recurring":
    case "settings-templates":
    case "settings-data":
    case "settings-preferences":
      return "settings";
    case "not-found":
      return null;
    default: {
      const unreachable: never = route;
      throw new RangeError(`Unknown route: ${String(unreachable)}`);
    }
  }
}
