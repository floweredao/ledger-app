import { CircleAlert, MapPinOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { clearCache, readLastAuth, writeLastAuth } from "./api/cache";
import { api, isNetworkError } from "./api/client";
import { clearMemoryCache } from "./api/hooks";
import { flushOutbox } from "./api/outbox";
import { onUnauthenticated, setCsrfToken } from "./api/transport";
import { AppShell } from "./components/AppShell";
import { Button } from "./components/Button";
import { EmptyState } from "./components/EmptyState";
import { componentMessages } from "./components/messages";
import { Skeleton } from "./components/Skeleton";
import { useMessages } from "./i18n";
import { common } from "./i18n/common";
import { Link, type Route, useRoute } from "./router";
import AssetDetail from "./screens/assets/AssetDetail";
import AssetsScreen from "./screens/assets/AssetsScreen";
import LedgerScreen from "./screens/ledger/LedgerScreen";
import SearchScreen from "./screens/ledger/SearchScreen";
import LoginScreen from "./screens/login/LoginScreen";
import CategoriesEditor from "./screens/settings/CategoriesEditor";
import DataScreen from "./screens/settings/DataScreen";
import MerchantRules from "./screens/settings/MerchantRules";
import Preferences from "./screens/settings/Preferences";
import RecurringEditor from "./screens/settings/RecurringEditor";
import SettingsScreen from "./screens/settings/SettingsScreen";
import TemplatesEditor from "./screens/settings/TemplatesEditor";
import StatsScreen from "./screens/stats/StatsScreen";

type AuthState =
  | { readonly status: "checking" }
  | { readonly status: "login"; readonly offline: boolean }
  | { readonly status: "authed"; readonly offline: boolean }
  | { readonly status: "error" };

function Screen({ route, onLoggedOut }: { readonly route: Route; readonly onLoggedOut: () => void }) {
  const t = useMessages(componentMessages);

  switch (route.name) {
    case "ledger":
    case "calendar":
    case "monthly":
    case "summary":
    case "memo":
      return <LedgerScreen />;
    case "search":
      return <SearchScreen />;
    case "stats":
    case "budget":
      return <StatsScreen />;
    case "assets":
      return <AssetsScreen />;
    case "asset-detail":
      return <AssetDetail key={route.params.id} id={route.params.id ?? ""} />;
    case "settings":
      return <SettingsScreen onLoggedOut={onLoggedOut} />;
    case "settings-categories":
      return <CategoriesEditor />;
    case "settings-rules":
      return <MerchantRules />;
    case "settings-recurring":
      return <RecurringEditor />;
    case "settings-templates":
      return <TemplatesEditor />;
    case "settings-data":
      return <DataScreen />;
    case "settings-preferences":
      return <Preferences />;
    case "not-found":
      return (
        <div className="screen">
          <h1 className="screen-title">{t.pageMissing}</h1>
          <EmptyState
            icon={MapPinOff}
            title={t.pageMissingHint}
            action={
              <Link to="/" className="btn btn-secondary">
                {t.goLedger}
              </Link>
            }
          />
        </div>
      );
    default: {
      const unreachable: never = route.name;
      throw new RangeError(`Unknown route: ${String(unreachable)}`);
    }
  }
}

export function App() {
  const t = useMessages(componentMessages);
  const c = useMessages(common);

  const [auth, setAuth] = useState<AuthState>({ status: "checking" });
  const route = useRoute();
  const onLoggedOut = useCallback(() => {
    writeLastAuth(false);
    clearMemoryCache();
    setAuth({ status: "login", offline: false });
    clearCache().catch((error: unknown) => console.warn("logout cache clear failed", error));
  }, []);

  const check = useCallback(async () => {
    try {
      const session = await api.session();
      writeLastAuth(session.authenticated);
      if (!session.authenticated) {
        setAuth({ status: "login", offline: false });
        return;
      }
      setAuth({ status: "authed", offline: false });
      flushOutbox().catch((error: unknown) => console.warn("outbox flush failed", error));
    } catch (error) {
      if (isNetworkError(error)) setAuth({ status: readLastAuth() ? "authed" : "login", offline: true });
      else setAuth({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(
    () =>
      onUnauthenticated(() => {
        writeLastAuth(false);
        setCsrfToken(null);
        clearMemoryCache();
        setAuth({ status: "login", offline: false });
      }),
    [],
  );

  const offline = (auth.status === "authed" || auth.status === "login") && auth.offline;
  useEffect(() => {
    if (!offline) return;
    const retry = () => void check();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [offline, check]);

  switch (auth.status) {
    case "checking":
      return (
        <main className="boot" id="main">
          <Skeleton rows={4} label={t.openingApp} />
        </main>
      );
    case "error":
      return (
        <main className="boot" id="main">
          <EmptyState
            tone="error"
            icon={CircleAlert}
            title={t.serverError}
            action={
              <Button variant="primary" onClick={() => void check()}>
                {c.retry}
              </Button>
            }
          />
        </main>
      );
    case "login":
      return <LoginScreen offline={auth.offline} onLoggedIn={() => void check()} />;
    case "authed":
      return (
        <AppShell>
          <Screen route={route} onLoggedOut={onLoggedOut} />
        </AppShell>
      );
    default: {
      const unreachable: never = auth;
      throw new RangeError(`Unknown auth state: ${JSON.stringify(unreachable)}`);
    }
  }
}
