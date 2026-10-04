import type { Database } from "bun:sqlite";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { toKstIso } from "../shared/dates";
import type { Config } from "./app";

export const SESSION_COOKIE = "ledger_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_TOUCH_MS = 60 * 60 * 1000;
const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 60 * 1000;

export type Session = {
  readonly token: string;
  readonly idHash: string;
  readonly csrfToken: string;
  readonly expiresAt: string;
  readonly lastSeenAt: string;
};

const CredentialsSchema = z.object({ owner_token: z.string().min(32).max(512) });
const SessionRowSchema = z.object({
  id_hash: z.string(),
  csrf_token: z.string(),
  expires_at: z.string(),
  last_seen_at: z.string(),
});

const secret = () => randomBytes(32).toString("base64url");
const sha256 = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest();
const sha256Hex = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex");

export function credentialsPath(dataDir: string): string {
  return join(dataDir, "credentials.json");
}

function loadOwnerTokenHash(dataDir: string): Buffer {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = credentialsPath(dataDir);
  if (!existsSync(path)) {
    writeFileSync(path, `${JSON.stringify({ owner_token: secret() }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  }
  chmodSync(path, 0o600);
  const { owner_token } = CredentialsSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  return sha256(owner_token);
}

export function allowedOrigins(config: Config): ReadonlySet<string> {
  const origins = new Set([
    ...config.LEDGER_ALLOWED_ORIGINS,
    `http://127.0.0.1:${config.LEDGER_PORT}`,
    `http://localhost:${config.LEDGER_PORT}`,
    "http://127.0.0.1:4341",
    "http://localhost:4341",
  ]);
  if (config.LEDGER_TAILSCALE_HOST) origins.add(`https://${config.LEDGER_TAILSCALE_HOST}`);
  return origins;
}

const hostOf = (request: Request) => request.headers.get("host") ?? new URL(request.url).host;

export class Auth {
  readonly origins: ReadonlySet<string>;
  readonly #ownerHash: Buffer;
  #loginAttempts: number[] = [];

  constructor(
    private readonly db: Database,
    private readonly config: Config,
  ) {
    this.#ownerHash = loadOwnerTokenHash(config.LEDGER_DATA_DIR);
    this.origins = allowedOrigins(config);
  }

  admitLoginAttempt(now = Date.now()): boolean {
    this.#loginAttempts = this.#loginAttempts.filter((at) => now - at < LOGIN_WINDOW_MS);
    this.#loginAttempts.push(now);
    return this.#loginAttempts.length <= LOGIN_LIMIT;
  }

  isOwnerToken(token: string): boolean {
    return timingSafeEqual(sha256(token), this.#ownerHash);
  }

  createSession(now = Date.now()): Session {
    const token = secret();
    const csrfToken = secret();
    const created = toKstIso(new Date(now));
    const expiresAt = toKstIso(new Date(now + SESSION_TTL_MS));
    const idHash = sha256Hex(token);
    this.db.query("DELETE FROM sessions WHERE expires_at<=?").run(created);
    this.db
      .query("INSERT INTO sessions(id_hash,csrf_token,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?)")
      .run(idHash, csrfToken, created, expiresAt, created);
    return { token, idHash, csrfToken, expiresAt, lastSeenAt: created };
  }

  findSession(request: Request, now = Date.now()): Session | null {
    const token = request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1);
    if (!token) return null;
    const row = this.db
      .query("SELECT id_hash,csrf_token,expires_at,last_seen_at FROM sessions WHERE id_hash=? AND expires_at>?")
      .get(sha256Hex(token), toKstIso(new Date(now)));
    if (!row) return null;
    const session = SessionRowSchema.parse(row);
    return {
      token,
      idHash: session.id_hash,
      csrfToken: session.csrf_token,
      expiresAt: session.expires_at,
      lastSeenAt: session.last_seen_at,
    };
  }

  /** Slides the 30-day expiry at most once an hour; returns the refreshed session when it moved. */
  touch(session: Session, now = Date.now()): Session | null {
    if (now - Date.parse(session.lastSeenAt) < SESSION_TOUCH_MS) return null;
    const lastSeenAt = toKstIso(new Date(now));
    const expiresAt = toKstIso(new Date(now + SESSION_TTL_MS));
    this.db
      .query("UPDATE sessions SET expires_at=?, last_seen_at=? WHERE id_hash=?")
      .run(expiresAt, lastSeenAt, session.idHash);
    return { ...session, expiresAt, lastSeenAt };
  }

  revoke(session: Session): void {
    this.db.query("DELETE FROM sessions WHERE id_hash=?").run(session.idHash);
  }

  /**
   * Tailscale Serve terminates HTTPS on the configured host and injects the tailnet login; any explicit
   * Authorization header or a different Host means the request did not come through that path.
   */
  isTailscaleOwner(request: Request): boolean {
    const { LEDGER_TAILSCALE_HOST: host, LEDGER_TAILSCALE_LOGIN: login } = this.config;
    return (
      host !== undefined &&
      login !== undefined &&
      !request.headers.has("authorization") &&
      hostOf(request) === host &&
      request.headers.get("tailscale-user-login") === login
    );
  }

  cookie(request: Request, session: Session): string {
    const maxAge = Math.max(0, Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000));
    return this.#cookie(request, `${SESSION_COOKIE}=${session.token}; Max-Age=${maxAge}`);
  }

  clearCookie(request: Request): string {
    return this.#cookie(request, `${SESSION_COOKIE}=; Max-Age=0`);
  }

  #cookie(request: Request, value: string): string {
    const secure =
      this.config.LEDGER_TAILSCALE_HOST !== undefined && hostOf(request) === this.config.LEDGER_TAILSCALE_HOST;
    return `${value}; Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
  }
}
