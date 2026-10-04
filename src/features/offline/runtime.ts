import { SessionStateSchema } from "../../../shared/schema";
import { flushOutbox } from "../../api/outbox";
import { apiJson, isApiError, isNetworkError, setCsrfToken } from "../../api/transport";
import { toast } from "../../components/Toast";

let reconnecting: Promise<void> | undefined;
export function reconnectOutbox(): Promise<void> {
  reconnecting ??= (async () => {
    try {
      const session = SessionStateSchema.parse(await apiJson("auth/session"));
      if (!session.authenticated) return;
      setCsrfToken(session.csrf_token);
      await flushOutbox();
    } catch (error) {
      if (isNetworkError(error) || isApiError(error)) return;
      throw error;
    }
  })().finally(() => {
    reconnecting = undefined;
  });
  return reconnecting;
}

export function reportSyncFailure(error: unknown): void {
  console.warn("outbox synchronization failed", error);
  toast({ message: "대기 기록을 동기화하지 못했어요. 다시 시도해 주세요" });
}
