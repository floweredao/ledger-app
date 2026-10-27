import { WifiOff } from "lucide-react";
import { usePendingCount } from "../api/outbox";
import { CacheSavedTime } from "../features/offline/CacheSavedTime";
import { offlineMessages } from "../features/offline/messages";
import { useMessages } from "../i18n";
import { componentMessages } from "./messages";

export function OfflineBanner() {
  const t = useMessages(componentMessages);
  const o = useMessages(offlineMessages);

  const count = usePendingCount();
  return (
    <div className="offline-banner" role="status">
      <WifiOff aria-hidden="true" size={16} strokeWidth={2} />
      <span>
        {t.offline} <CacheSavedTime /> · {o.pending(count)}
      </span>
    </div>
  );
}
