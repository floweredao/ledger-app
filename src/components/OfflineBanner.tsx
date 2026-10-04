import { WifiOff } from "lucide-react";

export function OfflineBanner() {
  return (
    <div className="offline-banner" role="status">
      <WifiOff aria-hidden="true" size={16} strokeWidth={2} />
      <span>오프라인이에요. 마지막으로 저장된 내용을 보여줘요.</span>
    </div>
  );
}
