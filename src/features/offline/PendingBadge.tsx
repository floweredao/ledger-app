import { CloudUpload } from "lucide-react";
import { useEffect } from "react";
import { usePendingCount } from "../../api/outbox";
import { toast } from "../../components/Toast";
import { messages, useMessages } from "../../i18n";
import { common } from "../../i18n/common";
import { CacheSavedTime } from "./CacheSavedTime";
import { offlineMessages } from "./messages";
import { reconnectOutbox, reportSyncFailure } from "./runtime";
import "./offline.css";

export default function PendingBadge() {
  const t = useMessages(offlineMessages);
  const c = useMessages(common);
  const count = usePendingCount();
  useEffect(() => {
    if (count === 0) return;
    const retry = () => {
      void reconnectOutbox().catch(reportSyncFailure);
    };
    window.addEventListener("online", retry);
    const interval = window.setInterval(retry, 30_000);
    retry();
    return () => {
      window.removeEventListener("online", retry);
      window.clearInterval(interval);
    };
  }, [count]);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const updated = (event: MessageEvent) => {
      if (event.data?.type !== "LEDGER_SW_UPDATED") return;
      toast({
        message: messages(offlineMessages).updateReady,
        action: { label: messages(offlineMessages).reload, onAction: () => window.location.reload() },
      });
    };
    navigator.serviceWorker.addEventListener("message", updated);
    return () => navigator.serviceWorker.removeEventListener("message", updated);
  }, []);
  if (count === 0) return null;
  return (
    <div className="pending-badge" role="status" aria-live="polite">
      <CloudUpload size={16} aria-hidden="true" />
      <span>{t.pending(count)}</span>
      <CacheSavedTime />
      <button type="button" onClick={() => void reconnectOutbox().catch(reportSyncFailure)}>
        {c.syncNow}
      </button>
    </div>
  );
}
