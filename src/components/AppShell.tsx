import { type ReactNode, useEffect } from "react";
import type { Settings } from "../../shared/schema";
import { paths } from "../api/client";
import { invalidate, useApi, useOnline } from "../api/hooks";
import EntryHost from "../features/entry/EntryHost";
import PendingBadge from "../features/offline/PendingBadge";
import { useRoute } from "../router";
import { sectionOf } from "./nav";
import { OfflineBanner } from "./OfflineBanner";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { ToastRegion } from "./Toast";

export function AppShell({ children }: { readonly children: ReactNode }) {
  const route = useRoute();
  const online = useOnline();
  const section = sectionOf(route.name);
  const settings = useApi<Settings>(paths.settings);
  // Warm the metadata needed to record a transaction on the next offline open.
  useApi(paths.categories());
  useApi(paths.assets());
  useApi(paths.templates);
  useApi(paths.merchantRules);
  useApi(paths.transactions({ limit: 100 }));
  useEffect(() => {
    const theme = settings.data?.theme;
    if (!theme) return;
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.dataset.theme = theme;
    try {
      if (theme === "system") localStorage.removeItem("ledger:theme");
      else localStorage.setItem("ledger:theme", theme);
    } catch {
      console.warn("theme_preference_not_persisted");
    }
  }, [settings.data?.theme]);
  useEffect(() => {
    const refresh = () => {
      if (document.hidden || document.querySelector('[role="dialog"]')) return;
      for (const prefix of ["transactions", "stats", "assets", "budgets", "sync"]) invalidate(prefix);
    };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, []);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        본문으로 건너뛰기
      </a>
      <Sidebar active={section} />
      <div className="app-column">
        <div className="app-status">
          {online ? null : <OfflineBanner />}
          <PendingBadge />
        </div>
        <main id="main" className="app-main" tabIndex={-1}>
          {children}
        </main>
      </div>
      <TabBar active={section} />
      <ToastRegion />
      <EntryHost />
    </div>
  );
}
