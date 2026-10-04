/**
 * Low-level HTTP for `/api/v1`: credentials, CSRF, JSON and typed errors. client.ts, hooks.ts and the
 * outbox (T23) build on this; it imports nothing else from src/api so there are no import cycles.
 */
export const API_BASE = "/api/v1";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The request never produced an HTTP response (offline, DNS, server down). Distinct from a 401. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super("Network request failed", { cause });
    this.name = "NetworkError";
  }
}

export const isNetworkError = (error: unknown): error is NetworkError => error instanceof NetworkError;
export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;

let csrfToken: string | null = null;
let loggedOut = false;
let sessionVersion = 0;
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
  if (token) loggedOut = false;
}

/** Explicit logout pauses automatic session discovery/replay until login or a fresh page load. */
export function markLoggedOut(): void {
  csrfToken = null;
  loggedOut = true;
  sessionVersion += 1;
}

type Listener = () => void;
const unauthenticatedListeners = new Set<Listener>();
/** Fires when a non-auth request comes back 401, so the app can return to the login screen. */
export function onUnauthenticated(listener: Listener): () => void {
  unauthenticatedListeners.add(listener);
  return () => unauthenticatedListeners.delete(listener);
}

let online = typeof navigator === "undefined" ? true : navigator.onLine;
const networkListeners = new Set<Listener>();
/** Records reachability; every request outcome and the browser online/offline events feed it. */
export function markNetwork(next: boolean): void {
  if (online === next) return;
  online = next;
  for (const listener of networkListeners) listener();
}
export const isOnline = (): boolean => online;
export function subscribeNetwork(listener: Listener): () => void {
  networkListeners.add(listener);
  return () => networkListeners.delete(listener);
}
if (typeof window !== "undefined") {
  window.addEventListener("online", () => markNetwork(true));
  window.addEventListener("offline", () => markNetwork(false));
}

/** `transactions?from=…` -> `/api/v1/transactions?from=…`; cache keys are the part after `/api/v1/`. */
export const apiUrl = (path: string): string => `${API_BASE}/${path.replace(/^\/+/, "")}`;

export type RequestOptions = {
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Serialized as JSON with a JSON Content-Type. */
  readonly json?: unknown;
  /** Sent as-is (FormData, Blob); the browser sets Content-Type. */
  readonly body?: BodyInit;
  readonly headers?: Readonly<Record<string, string>>;
};

async function toApiError(response: Response): Promise<ApiError> {
  const fallback = new ApiError(response.status, `http_${response.status}`, response.statusText || "Request failed");
  const text = await response.text();
  if (text === "") return fallback;
  try {
    const body = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } };
    const { code, message } = body.error ?? {};
    if (typeof code === "string")
      return new ApiError(response.status, code, typeof message === "string" ? message : "");
    return fallback;
  } catch {
    // A non-JSON error body (proxy page, plain text) still maps to the status-based error.
    return fallback;
  }
}

export async function apiFetch(path: string, options: RequestOptions = {}): Promise<Response> {
  const method = options.method ?? "GET";
  if (loggedOut) {
    if (path === "auth/session" && method === "GET") {
      return Response.json({ authenticated: false, csrf_token: null, expires_at: null });
    }
    if (!path.startsWith("auth/")) throw new ApiError(401, "unauthenticated", "Session required");
  }
  const version = sessionVersion;
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  let body: BodyInit | null = options.body ?? null;
  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.json);
  }
  if (method !== "GET" && csrfToken) headers.set("X-CSRF-Token", csrfToken);
  let response: Response;
  try {
    response = await fetch(apiUrl(path), { method, headers, body, credentials: "same-origin" });
  } catch (error) {
    markNetwork(false);
    throw new NetworkError(error);
  }
  if (version !== sessionVersion) throw new ApiError(401, "unauthenticated", "Session ended");
  markNetwork(true);
  if (response.ok) return response;
  const error = await toApiError(response);
  if (response.status === 401 && !path.startsWith("auth/")) {
    for (const listener of unauthenticatedListeners) listener();
  }
  throw error;
}

export async function apiJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const version = sessionVersion;
  const response = await apiFetch(path, options);
  const text = await response.text();
  if (version !== sessionVersion) throw new ApiError(401, "unauthenticated", "Session ended");
  return (text === "" ? undefined : JSON.parse(text)) as T;
}
