import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import type { Settings } from "../../shared/schema";
import { paths } from "../api/client";
import { invalidate, useApi, useOnline } from "../api/hooks";
import EntryHost, { ENTRY_CATEGORIES } from "../features/entry/EntryHost";
import PendingBadge from "../features/offline/PendingBadge";
import { setLanguagePreference, useMessages } from "../i18n";
import { common } from "../i18n/common";
import { clearSectionHistory, type RouteName, takeNavigationArrival, useRoute } from "../router";
import { ICON_STROKE_WIDTH } from "./Button";
import { componentMessages } from "./messages";
import { sectionOf } from "./nav";
import { OfflineBanner } from "./OfflineBanner";
import { RecordButton } from "./RecordButton";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { ToastRegion } from "./Toast";

export function AppShell({ children }: { readonly children: ReactNode }) {
  const t = useMessages(componentMessages);
  const c = useMessages(common);

  const SCREEN_TITLES: Readonly<Record<RouteName, string>> = {
    ledger: c.appName,
    calendar: t.calendar,
    monthly: t.monthly,
    summary: t.summary,
    memo: t.memo,
    search: t.search,
    stats: t.stats,
    budget: t.budget,
    assets: t.assets,
    "asset-detail": t.assetDetail,
    settings: t.settings,
    "settings-categories": t.categories,
    "settings-rules": t.merchantRules,
    "settings-recurring": t.recurring,
    "settings-templates": t.templates,
    "settings-data": t.data,
    "settings-preferences": t.preferences,
    "not-found": t.pageMissing,
  };
  const route = useRoute();
  const mainRef = useRef<HTMLElement>(null);
  const title = SCREEN_TITLES[route.name];
  useLayoutEffect(() => {
    document.title = title === c.appName ? title : `${title} · ${c.appName}`;
  }, [title, c.appName]);
  useLayoutEffect(() => {
    const position = takeNavigationArrival(`${route.path}${route.query.size ? `?${route.query}` : ""}`);
    const main = mainRef.current;
    if (!position || !main) return;
    // Explicit navigation focuses the stable main, not body or a disappearing link.
    // preventScroll keeps section-return focus from overwriting the saved position.
    main.focus({ preventScroll: true });
    const restore = () => {
      window.scrollTo(position.x, position.y);
      return document.documentElement.scrollHeight - window.innerHeight >= position.y;
    };
    if (restore()) return;
    // Cached or asynchronous screen content may need to lay out before it can scroll.
    const observer = new ResizeObserver(() => {
      if (restore()) observer.disconnect();
    });
    observer.observe(main);
    return () => observer.disconnect();
  }, [route]);
  useEffect(() => clearSectionHistory, []);
  const online = useOnline();
  const section = sectionOf(route.name);
  const settings = useApi<Settings>(paths.settings);
  // Warm the metadata needed to record a transaction on the next offline open.
  useApi(ENTRY_CATEGORIES);
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
    const language = settings.data?.language;
    if (language) setLanguagePreference(language);
  }, [settings.data?.language]);
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
    <div className="app-shell" data-fab={section && section !== "settings" ? "" : undefined} style={{ strokeWidth: ICON_STROKE_WIDTH }}>
      <a className="skip-link" href="#main">
        {t.skipContent}
      </a>
      <Sidebar active={section} />
      <div className="app-column">
        <div className="app-status">
          {online ? null : <OfflineBanner />}
          <PendingBadge />
        </div>
        <main ref={mainRef} id="main" className="app-main" tabIndex={-1}>
          {children}
        </main>
      </div>
      <TabBar active={section} />
      {section && section !== "settings" ? <RecordButton /> : null}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" aria-label={t.screenNavigation}>
        {title}
      </div>
      <ToastRegion />
      <EntryHost />
    </div>
  );
}
