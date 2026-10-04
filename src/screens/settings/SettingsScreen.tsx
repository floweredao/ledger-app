import { LogOut } from "lucide-react";
import { useState } from "react";
import { api, isNetworkError } from "../../api/client";
import { ConfirmDialog } from "../../components/Dialog";
import { ListRow } from "../../components/ListRow";
import { Link } from "../../router";

const VERSION = "0.0.1";

const MENU_ITEMS = [
  { label: "분류 관리", href: "/settings/categories" },
  { label: "가게별 자동 분류", href: "/settings/rules" },
  { label: "반복 거래", href: "/settings/recurring" },
  { label: "자주 쓰는 내역", href: "/settings/templates" },
  { label: "데이터", href: "/settings/data" },
  { label: "환경 설정", href: "/settings/preferences" },
];

export default function SettingsScreen({ onLoggedOut }: { readonly onLoggedOut: () => void }) {
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
      setLogoutError(
        isNetworkError(error)
          ? "서버에 연결하지 못해 로그아웃을 확인하지 못했어요. 연결 후 다시 시도해 주세요."
          : "로그아웃하지 못했어요. 다시 시도해 주세요.",
      );
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <>
      <div className="screen">
        <h1 className="screen-title">설정</h1>

        <section className="settings-menu">
          {MENU_ITEMS.map((item) => (
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
            <ListRow title="로그아웃" leading={<LogOut size={20} />} />
          </button>
        </section>

        <footer className="settings-footer">
          <p className="settings-version">{VERSION}</p>
        </footer>
      </div>

      <ConfirmDialog
        open={showLogoutConfirm}
        title="로그아웃"
        description={logoutError ?? "정말 로그아웃할까요?"}
        confirmLabel="로그아웃"
        cancelLabel="취소"
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
