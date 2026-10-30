import {
  ChevronRight,
  DatabaseBackup,
  LogOut,
  type LucideIcon,
  PiggyBank,
  Repeat,
  SlidersHorizontal,
  Star,
  Store,
  Tags,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { api, isNetworkError } from "../../api/client";
import { ConfirmDialog } from "../../components/Dialog";
import { ListRow } from "../../components/ListRow";
import { messages, useMessages } from "../../i18n";
import { common } from "../../i18n/common";
import { settingsMessages } from "./messages";
import "./settings.css";

const VERSION = "0.0.1";

type MenuItem = { readonly label: string; readonly hint: string; readonly href: string; readonly icon: LucideIcon };

/** Grouped like 편한가계부's 설정: ledger habits, catalog (categories and assets), then data. */
const menuGroups = (): readonly { readonly title: string; readonly items: readonly MenuItem[] }[] => {
  const m = messages(settingsMessages);
  return [
    {
      title: m.groupLedger,
      items: [
        { label: m.preferences, hint: m.preferencesHint, href: "/settings/preferences", icon: SlidersHorizontal },
        { label: m.recurring, hint: m.recurringHint, href: "/settings/recurring", icon: Repeat },
        { label: m.templates, hint: m.templatesHint, href: "/settings/templates", icon: Star },
      ],
    },
    {
      title: m.groupCatalog,
      items: [
        { label: m.categories, hint: m.categoriesHint, href: "/settings/categories", icon: Tags },
        { label: m.rules, hint: m.merchantRulesHint, href: "/settings/rules", icon: Store },
        { label: m.assetSettings, hint: m.assetSettingsHint, href: "/assets", icon: Wallet },
        { label: m.budgetSettings, hint: m.budgetSettingsHint, href: "/budget", icon: PiggyBank },
      ],
    },
    {
      title: m.groupData,
      items: [{ label: m.data, hint: m.dataHint, href: "/settings/data", icon: DatabaseBackup }],
    },
  ];
};

export default function SettingsScreen({ onLoggedOut }: { readonly onLoggedOut: () => void }) {
  const m = useMessages(settingsMessages);
  const c = useMessages(common);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const handleLogout = async () => {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await api.logout();
      setShowLogoutConfirm(false);
      onLoggedOut();
    } catch (error) {
      setLogoutError(isNetworkError(error) ? m.logoutOffline : m.logoutFailed);
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <>
      <div className="screen settings-screen">
        <header className="settings-topbar">
          <span aria-hidden="true" />
          <h1 className="settings-title">{m.settings}</h1>
          <p className="settings-version">{VERSION}</p>
        </header>

        {menuGroups().map((group) => (
          <section key={group.title} className="settings-group" aria-labelledby={`settings-${group.title}`}>
            <h2 className="settings-group-title" id={`settings-${group.title}`}>
              {group.title}
            </h2>
            <div className="settings-group-rows">
              {group.items.map((item) => (
                <ListRow
                  key={item.href}
                  to={item.href}
                  leading={<item.icon size={20} aria-hidden="true" />}
                  title={item.label}
                  subtitle={item.hint}
                  trailing={<ChevronRight size={18} aria-hidden="true" />}
                />
              ))}
            </div>
          </section>
        ))}

        <section className="settings-group" aria-label={m.groupAccount}>
          <div className="settings-group-rows">
            <ListRow
              leading={<LogOut size={20} aria-hidden="true" />}
              title={m.logout}
              onClick={() => {
                setLogoutError(null);
                setShowLogoutConfirm(true);
              }}
            />
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={showLogoutConfirm}
        title={m.logout}
        description={logoutError ?? m.confirmLogout}
        confirmLabel={m.logout}
        cancelLabel={c.cancel}
        destructive
        busy={loggingOut}
        onConfirm={() => void handleLogout()}
        onCancel={() => setShowLogoutConfirm(false)}
      />
      {logoutError ? (
        <p role="alert" className="sr-only">
          {logoutError}
        </p>
      ) : null}
    </>
  );
}
