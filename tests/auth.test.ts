import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { credentialsPath } from "../server/auth";
import { authed, makeTestApp, TEST_ORIGIN, type TestApp } from "./helpers";

const TAILSCALE_HOST = "ledger.example.test:4340";
const TAILSCALE_LOGIN = "owner@example.com";
const apps: TestApp[] = [];
const setup = (env?: Record<string, string>) => {
  const app = makeTestApp(env ? { env } : {});
  apps.push(app);
  return app;
};
afterEach(() => {
  for (const app of apps.splice(0)) app.cleanup();
});

const login = (app: TestApp, token: string, origin = TEST_ORIGIN) =>
  app.request("/api/v1/auth/session", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });

describe("owner token login", () => {
  test("creates credentials.json with mode 0600", () => {
    const app = setup();
    expect(statSync(credentialsPath(app.dataDir)).mode & 0o777).toBe(0o600);
  });

  test("rejects a wrong token with 401 and no cookie", async () => {
    const app = setup();
    const response = await login(app, "wrong-token");
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("accepts the owner token with an HttpOnly SameSite=Strict session cookie", async () => {
    const app = setup();
    const response = await login(app, app.ownerToken);
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toStartWith("ledger_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Secure");
    const body = await response.json();
    expect(body).toEqual({ authenticated: true, csrf_token: expect.any(String), expires_at: expect.any(String) });
  });

  test("rejects a login from a disallowed Origin with 403", async () => {
    const app = setup();
    expect((await login(app, app.ownerToken, "https://evil.example")).status).toBe(403);
  });

  test("answers the 6th attempt within a minute with 429", async () => {
    const app = setup();
    for (let attempt = 0; attempt < 5; attempt++) expect((await login(app, "wrong-token")).status).toBe(401);
    const sixth = await login(app, app.ownerToken);
    expect(sixth.status).toBe(429);
    expect(await sixth.json()).toEqual({ error: { code: "rate_limited", message: expect.any(String) } });
  });
});

describe("session and CSRF guard", () => {
  test("serves health without a session", async () => {
    const response = await setup().request("/api/v1/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, version: "0.0.1" });
  });

  test("requires a session for API reads", async () => {
    const response = await setup().request("/api/v1/transactions");
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("unauthenticated");
  });

  test("passes an authenticated mutation with Origin and CSRF through to the route", async () => {
    const fetch = await authed(setup());
    const response = await fetch("/api/v1/transactions", {
      method: "POST",
      body: {
        type: "expense",
        amount: 4500,
        occurred_at: "2026-10-04T09:00:00+09:00",
        merchant: "샘플카페",
      },
    });
    expect(response.status).toBe(201);
    expect((await response.json()).merchant).toBe("샘플카페");
  });

  test("rejects a mutation without X-CSRF-Token with 403", async () => {
    const app = setup();
    const fetch = await authed(app);
    const response = await app.request("/api/v1/transactions", {
      method: "POST",
      headers: { Cookie: fetch.cookie, Origin: TEST_ORIGIN, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("csrf");
  });

  test("rejects a mutation from a wrong Origin with 403", async () => {
    const fetch = await authed(setup());
    const response = await fetch("/api/v1/transactions", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
      body: {},
    });
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("origin");
  });

  test("reports the session and revokes it on DELETE", async () => {
    const app = setup();
    const fetch = await authed(app);
    expect(await (await fetch("/api/v1/auth/session")).json()).toEqual({
      authenticated: true,
      csrf_token: fetch.csrfToken,
      expires_at: expect.any(String),
    });
    expect((await fetch("/api/v1/auth/session", { method: "DELETE" })).status).toBe(200);
    expect((await fetch("/api/v1/transactions")).status).toBe(401);
  });

  test("answers unknown API paths with a JSON 404", async () => {
    const fetch = await authed(setup());
    const response = await fetch("/api/v1/nope");
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
  });

  test("sets the security headers", async () => {
    const response = await setup().request("/api/v1/health");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
});

describe("Tailscale bootstrap", () => {
  const tailscale = { LEDGER_TAILSCALE_HOST: TAILSCALE_HOST, LEDGER_TAILSCALE_LOGIN: TAILSCALE_LOGIN };
  const probe = (app: TestApp, headers: Record<string, string>) =>
    app.request(`http://${TAILSCALE_HOST}/api/v1/auth/session`, { headers });

  test("creates a Secure session for the exact Host and login", async () => {
    const response = await probe(setup(tailscale), { Host: TAILSCALE_HOST, "Tailscale-User-Login": TAILSCALE_LOGIN });
    expect(await response.json()).toEqual({
      authenticated: true,
      csrf_token: expect.any(String),
      expires_at: expect.any(String),
    });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
  });

  test.each([
    ["a different Host", { Host: "127.0.0.1:4340", "Tailscale-User-Login": TAILSCALE_LOGIN }],
    ["a different login", { Host: TAILSCALE_HOST, "Tailscale-User-Login": "someone@example.com" }],
    ["no login header", { Host: TAILSCALE_HOST }],
    [
      "an Authorization header",
      { Host: TAILSCALE_HOST, "Tailscale-User-Login": TAILSCALE_LOGIN, Authorization: "Bearer x" },
    ],
  ])("refuses %s", async (_label, headers) => {
    const response = await probe(setup(tailscale), headers);
    expect(await response.json()).toEqual({ authenticated: false, csrf_token: null, expires_at: null });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("stays off when the Tailscale host and login are not configured", async () => {
    const response = await probe(setup(), { Host: TAILSCALE_HOST, "Tailscale-User-Login": TAILSCALE_LOGIN });
    expect(await response.json()).toEqual({ authenticated: false, csrf_token: null, expires_at: null });
  });
});

describe("startup", () => {
  test("default source path follows the running user home", async () => {
    const home = mkdtempSync(join(tmpdir(), "ledger-home-"));
    try {
      const source = join(import.meta.dir, "../server/app.ts");
      const script = `import {homedir} from "node:os"; import {join} from "node:path";
        import {DEFAULT_LEDGER_MODULE} from ${JSON.stringify(source)};
        console.log(DEFAULT_LEDGER_MODULE === join(homedir(), ".local/share/ddolmeng-mode/bin/ledger.ts"));`;
      const child = Bun.spawn([process.execPath, "-e", script], {
        env: { ...process.env, HOME: home },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()]);
      expect(code).toBe(0);
      expect(output.trim()).toBe("true");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("refuses LEDGER_HOST=0.0.0.0 and exits non-zero", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ledger-host-"));
    try {
      const child = Bun.spawn(["bun", join(import.meta.dir, "../server/index.ts")], {
        env: { ...process.env, LEDGER_HOST: "0.0.0.0", LEDGER_PORT: "0", LEDGER_DATA_DIR: dataDir },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("LEDGER_HOST");
      expect(stdout).not.toContain("listening");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
