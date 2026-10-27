import { defineMessages } from "../../i18n";
import { formatNumber } from "../../i18n/format";

export const offlineMessages = defineMessages(
  {
    updateReady: "새 버전이 준비됐어요",
    reload: "새로고침",
    pending: (count: number) => `동기화 대기 ${formatNumber(count)}건`,
    lastSaved: "서버 자료 마지막 저장:",
    unknownTime: "시각 정보가 없어요",
    syncFailed: "대기 기록을 동기화하지 못했어요. 다시 시도해 주세요",
  },
  {
    updateReady: "A new version is ready",
    reload: "Reload",
    pending: (count: number) => `${formatNumber(count)} ${count === 1 ? "record" : "records"} waiting to sync`,
    lastSaved: "Last saved from server:",
    unknownTime: "Save time unavailable",
    syncFailed: "Couldn't sync pending records. Try again.",
  },
);
