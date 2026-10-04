import { CloudUpload } from "lucide-react";
import { useEffect } from "react";
import { usePendingCount } from "../../api/outbox";
import { toast } from "../../components/Toast";
import { reconnectOutbox, reportSyncFailure } from "./runtime";
import "./offline.css";

export default function PendingBadge() {
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
        message: "새 버전이 준비됐어요",
        action: { label: "새로고침", onAction: () => window.location.reload() },
      });
    };
    navigator.serviceWorker.addEventListener("message", updated);
    return () => navigator.serviceWorker.removeEventListener("message", updated);
  }, []);
  if (count === 0) return null;
  return (
    <div className="pending-badge" role="status" aria-live="polite">
      <CloudUpload size={16} aria-hidden="true" />
      <span>동기화 대기 {count}건</span>
      <button type="button" onClick={() => void reconnectOutbox().catch(reportSyncFailure)}>
        지금 동기화
      </button>
    </div>
  );
}
