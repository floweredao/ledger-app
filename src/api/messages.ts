import { defineMessages, getLocale, messages } from "../i18n";
import { isApiError, isNetworkError } from "./transport";

export const apiMessages = defineMessages(
  {
    pendingLoadFailed: "동기화 대기 기록을 열지 못했어요",
    requestFailed: "요청을 처리하지 못했어요. 다시 시도해 주세요.",
    networkFailed: "서버에 연결하지 못했어요. 연결 후 다시 시도해 주세요.",
    invalidInput: "입력값을 확인해 주세요.",
    unauthenticated: "다시 로그인해 주세요.",
    forbidden: "요청을 확인하지 못했어요. 새로고침 후 다시 시도해 주세요.",
    notFound: "기록을 찾을 수 없어요.",
    conflict: "다른 기록과 충돌해요. 새로고침 후 다시 시도해 주세요.",
    inUse: "사용 중인 데이터라 삭제할 수 없어요.",
    tooLarge: "파일이나 요청이 너무 커요.",
    unsupported: "지원하지 않는 형식이에요.",
    rateLimited: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.",
    unavailable: "현재 사용할 수 없어요. 나중에 다시 시도해 주세요.",
    syncRejected: (reason: string) => `동기화하지 못한 기록을 제외했어요: ${reason}`,
  },
  {
    pendingLoadFailed: "Couldn't open pending records",
    requestFailed: "Couldn't complete the request. Try again.",
    networkFailed: "Couldn't connect to the server. Check your connection and try again.",
    invalidInput: "Check the values you entered.",
    unauthenticated: "Sign in again to continue.",
    forbidden: "Couldn't verify the request. Refresh and try again.",
    notFound: "This record couldn't be found.",
    conflict: "This conflicts with another record. Refresh and try again.",
    inUse: "This data is in use and can't be deleted.",
    tooLarge: "The file or request is too large.",
    unsupported: "This format is not supported.",
    rateLimited: "Too many requests. Try again shortly.",
    unavailable: "This is unavailable right now. Try again later.",
    syncRejected: (reason: string) => `Removed a record that could not sync: ${reason}`,
  },
);

/** Keep existing Korean server copy; never expose raw server errors or codes in English. */
export function apiErrorMessage(error: unknown, fallback = messages(apiMessages).requestFailed): string {
  if (getLocale() === "ko" && error instanceof Error) {
    return error.message || fallback;
  }
  const m = messages(apiMessages);
  if (isNetworkError(error)) return m.networkFailed;
  if (!isApiError(error)) return fallback;
  if (error.code.startsWith("invalid_") || error.code === "max_depth") return m.invalidInput;
  switch (error.code) {
    case "unauthenticated":
      return m.unauthenticated;
    case "origin":
    case "csrf":
      return m.forbidden;
    case "not_found":
    case "preview_not_found":
      return m.notFound;
    case "conflict":
      return m.conflict;
    case "in_use":
      return m.inUse;
    case "too_large":
      return m.tooLarge;
    case "unsupported_media_type":
      return m.unsupported;
    case "rate_limited":
      return m.rateLimited;
    case "not_available":
      return m.unavailable;
    default:
      return fallback;
  }
}
