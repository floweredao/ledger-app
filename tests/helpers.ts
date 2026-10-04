import type { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { z } from "zod";
import { type Config, createApp, type Importer, parseConfig } from "../server/app";
import { credentialsPath } from "../server/auth";
import { openDb } from "../server/db";
import type { AppBindings } from "../server/http";

export const TEST_PORT = 4340;
export const TEST_ORIGIN = `http://127.0.0.1:${TEST_PORT}`;

export type TestApp = {
  readonly app: Hono<AppBindings>;
  readonly db: Database;
  readonly config: Config;
  readonly dataDir: string;
  readonly ownerToken: string;
  readonly request: (path: string, init?: RequestInit) => Promise<Response>;
  readonly cleanup: () => void;
};

export type TestAppOptions = {
  readonly env?: Record<string, string>;
  readonly importer?: Importer;
};

/** An app over an in-memory database with credentials in a fresh temp data dir; call `cleanup()` afterwards. */
export function makeTestApp(options: TestAppOptions = {}): TestApp {
  const dataDir = mkdtempSync(join(tmpdir(), "ledger-test-"));
  const config = parseConfig({
    LEDGER_DATA_DIR: dataDir,
    LEDGER_PORT: String(TEST_PORT),
    LEDGER_STATIC_DIR: join(dataDir, "dist"),
    ...options.env,
  });
  const db = openDb(":memory:");
  const app = createApp({ db, env: config, ...(options.importer ? { importer: options.importer } : {}) });
  const { owner_token: ownerToken } = z
    .object({ owner_token: z.string() })
    .parse(JSON.parse(readFileSync(credentialsPath(dataDir), "utf8")));
  return {
    app,
    db,
    config,
    dataDir,
    ownerToken,
    request: async (path, init) => app.request(path, init),
    cleanup: () => {
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export type AuthedInit = Omit<RequestInit, "body"> & { readonly body?: unknown };
export type AuthedFetch = ((path: string, init?: AuthedInit) => Promise<Response>) & {
  readonly cookie: string;
  readonly csrfToken: string;
};

/** Logs in with the owner token and returns a fetch that sends the cookie, `X-CSRF-Token`, Origin and JSON bodies. */
export async function authed(test: TestApp): Promise<AuthedFetch> {
  const login = await test.request("/api/v1/auth/session", {
    method: "POST",
    headers: { Origin: TEST_ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ token: test.ownerToken }),
  });
  if (login.status !== 200) throw new Error(`login failed with ${login.status}`);
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const { csrf_token: csrfToken } = z.object({ csrf_token: z.string() }).parse(await login.json());
  const fetcher = (path: string, init: AuthedInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Cookie", cookie);
    headers.set("X-CSRF-Token", csrfToken);
    if (!headers.has("Origin")) headers.set("Origin", TEST_ORIGIN);
    const { body, ...rest } = init;
    let payload: BodyInit | undefined;
    if (body === undefined || body instanceof FormData || typeof body === "string") payload = body;
    else {
      payload = JSON.stringify(body);
      headers.set("Content-Type", "application/json");
    }
    return test.request(path, { ...rest, headers, ...(payload === undefined ? {} : { body: payload }) });
  };
  return Object.assign(fetcher, { cookie, csrfToken });
}
