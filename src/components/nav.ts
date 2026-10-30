import { BookOpen, ChartPie, Ellipsis, type LucideIcon, PiggyBank, Wallet } from "lucide-react";
import { messages } from "../i18n";
import { common } from "../i18n/common";
import type { RouteName } from "../router";
import { componentMessages } from "./messages";

export type Section = "ledger" | "stats" | "budget" | "assets" | "settings";

export const NAV_ITEMS: readonly { section: Section; to: string; label: string; icon: LucideIcon }[] = [
  {
    section: "ledger",
    to: "/",
    get label() {
      return messages(common).appName;
    },
    icon: BookOpen,
  },
  {
    section: "stats",
    to: "/stats",
    get label() {
      return messages(componentMessages).stats;
    },
    icon: ChartPie,
  },
  {
    section: "budget",
    to: "/budget",
    get label() {
      return messages(componentMessages).budget;
    },
    icon: PiggyBank,
  },
  {
    section: "assets",
    to: "/assets",
    get label() {
      return messages(componentMessages).assets;
    },
    icon: Wallet,
  },
  {
    section: "settings",
    to: "/settings",
    get label() {
      return messages(componentMessages).more;
    },
    icon: Ellipsis,
  },
];

export function sectionOf(route: RouteName): Section | null {
  switch (route) {
    case "ledger":
    case "calendar":
    case "monthly":
    case "summary":
    case "memo":
    case "search":
      return "ledger";
    case "stats":
      return "stats";
    case "budget":
      return "budget";
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
