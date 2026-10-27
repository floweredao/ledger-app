import { LogOut } from "lucide-react";
import { useState } from "react";
import { api, isNetworkError } from "../../api/client";
import { ConfirmDialog } from "../../components/Dialog";
import { ListRow } from "../../components/ListRow";
import { messages, useMessages } from "../../i18n";
import { common } from "../../i18n/common";
import { Link } from "../../router";
import { settingsMessages } from "./messages";

const VERSION = "0.0.1";

const menuItems = () => [
  { label: messages(settingsMessages).categories, href: "/settings/categories" },
  { label: messages(settingsMessages).rules, href: "/settings/rules" },
  { label: messages(settingsMessages).recurring, href: "/settings/recurring" },
  { label: messages(settingsMessages).templates, href: "/settings/templates" },
  { label: messages(settingsMessages).data, href: "/settings/data" },
  { label: messages(settingsMessages).preferences, href: "/settings/preferences" },
];

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
      <div className="screen">
        <h1 className="screen-title">{m.settings}</h1>

        <section className="settings-menu">
          {menuItems().map((item) => (
            <Link key={item.href} to={item.href} className="list-row-container">
              <ListRow title={item.label} />
            </Link>
          ))}

          <button
            type="button"
            className="list-row-container"
            onClick={() => {
              setLogoutError(null);
              setShowLogoutConfirm(true);
            }}
          >
            <ListRow title={m.logout} leading={<LogOut size={20} />} />
          </button>
        </section>

        <footer className="settings-footer">
          <p className="settings-version">{VERSION}</p>
        </footer>
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
