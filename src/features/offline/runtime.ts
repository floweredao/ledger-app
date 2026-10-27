import { SessionStateSchema } from "../../../shared/schema";
import { flushOutbox } from "../../api/outbox";
import { apiJson, isApiError, isNetworkError, setCsrfToken } from "../../api/transport";
import { toast } from "../../components/Toast";
import { messages } from "../../i18n";
import { offlineMessages } from "./messages";

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
  toast({ message: messages(offlineMessages).syncFailed, tone: "error" });
}
