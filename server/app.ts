import type { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import { Auth } from "./auth";
import { ApiError, type AppBindings, onError } from "./http";
import type { Importer } from "./importer/run";
import { assetsRoutes } from "./routes/assets";
import { authRoutes } from "./routes/auth";
import { backupRoutes } from "./routes/backup";
import { budgetsRoutes } from "./routes/budgets";
import { categoriesRoutes } from "./routes/categories";
import { ioRoutes } from "./routes/io";
import { recurringRoutes } from "./routes/recurring";
import { settingsRoutes } from "./routes/settings";
import { statsRoutes } from "./routes/stats";
import { syncRoutes } from "./routes/sync";
import { templatesRoutes } from "./routes/templates";
import { transactionsRoutes } from "./routes/transactions";

export const VERSION = pkg.version;
export const DEFAULT_LEDGER_MODULE = join(homedir(), ".local/share/ddolmeng-mode/bin/ledger.ts");

const optionalText = z.preprocess((value) => (value === "" ? undefined : value), z.string().trim().min(1).optional());
const origin = z
  .url()
  .refine((value) => new URL(value).origin === value, "Expected a bare origin like https://host:port");

export const ConfigSchema = z
  .object({
    LEDGER_HOST: z.enum(["127.0.0.1", "localhost", "::1"]).default("127.0.0.1"),
    LEDGER_PORT: z.coerce.number().int().min(0).max(65535).default(4340),
    LEDGER_DATA_DIR: z
      .string()
      .default("./data")
      .transform((value) => resolve(process.cwd(), value)),
    LEDGER_STATIC_DIR: z
      .string()
      .default("./dist")
      .transform((value) => resolve(process.cwd(), value)),
    LEDGER_TAILSCALE_HOST: optionalText,
    LEDGER_TAILSCALE_LOGIN: optionalText,
    LEDGER_ALLOWED_ORIGINS: z
      .string()
      .default("")
      .transform((value) =>
        value
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item !== ""),
      )
      .pipe(z.array(origin)),
    LEDGER_MODULE: z.string().min(1).default(DEFAULT_LEDGER_MODULE),
    LEDGER_IMPORT_INTERVAL_MS: z.coerce.number().int().min(1000).default(60_000),
    LEDGER_WATCH_DIR: optionalText,
  })
  .transform((config) => ({
    ...config,
    LEDGER_WATCH_DIR: config.LEDGER_WATCH_DIR
      ? resolve(process.cwd(), config.LEDGER_WATCH_DIR)
      : config.LEDGER_MODULE === DEFAULT_LEDGER_MODULE
        ? resolve(dirname(config.LEDGER_MODULE), "../state/ledger")
        : null,
  }));
export type Config = z.output<typeof ConfigSchema>;

export function parseConfig(env: Record<string, string | undefined>): Config {
  return ConfigSchema.parse(env);
}

export type { Importer };

export type AppOptions = {
  readonly db: Database;
  readonly env: Config;
  readonly importer?: Importer;
};

const CSP =
  "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'";
const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const PUBLIC_API = new Set(["/api/v1/health", "/api/v1/auth/session"]);
const domainRoutes = [
  transactionsRoutes,
  categoriesRoutes,
  assetsRoutes,
  budgetsRoutes,
  recurringRoutes,
  templatesRoutes,
  statsRoutes,
  ioRoutes,
  backupRoutes,
  settingsRoutes,
  syncRoutes,
];

export function createApp({ db, env, importer }: AppOptions): Hono<AppBindings> {
  const auth = new Auth(db, env);
  const app = new Hono<AppBindings>();
  app.onError(onError);

  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("config", env);
    c.set("auth", auth);
    c.set("importer", importer);
    await next();
    c.header("Content-Security-Policy", CSP);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    if (c.req.path.startsWith("/api/")) c.header("Cache-Control", "no-store");
  });

  app.use("/api/v1/*", async (c, next) => {
    if (PUBLIC_API.has(c.req.path)) return next();
    const session = auth.findSession(c.req.raw);
    if (!session) throw new ApiError(401, "unauthenticated", "Session required");
    if (MUTATIONS.has(c.req.method)) {
      if (!auth.origins.has(c.req.header("origin") ?? "")) throw new ApiError(403, "origin", "Allowed Origin required");
      if (c.req.header("x-csrf-token") !== session.csrfToken) throw new ApiError(403, "csrf", "CSRF token required");
    }
    c.set("session", session);
    const touched = auth.touch(session);
    if (touched) c.header("Set-Cookie", auth.cookie(c.req.raw, touched));
    await next();
  });

  app.get("/api/v1/health", (c) => c.json({ ok: true, version: VERSION }));
  app.route("/api/v1", authRoutes);
  for (const routes of domainRoutes) app.route("/api/v1", routes);
  app.all("/api/*", (c) => c.json({ error: { code: "not_found", message: "Route not found" } }, 404));

  const staticRoot = env.LEDGER_STATIC_DIR;
  const isFile = (path: string) => existsSync(path) && statSync(path).isFile();
  app.get("*", async (c) => {
    const requested = resolve(join(staticRoot, decodeURIComponent(c.req.path)));
    if (requested.startsWith(staticRoot + sep) && isFile(requested)) {
      const immutable = c.req.path.startsWith("/static/");
      c.header("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
      return c.body(Bun.file(requested).stream(), 200, { "Content-Type": Bun.file(requested).type });
    }
    const index = join(staticRoot, "index.html");
    if (!isFile(index)) return c.json({ error: { code: "not_found", message: "Client build not found" } }, 404);
    c.header("Cache-Control", "no-cache");
    return c.html(await Bun.file(index).text());
  });
  app.notFound((c) => c.json({ error: { code: "not_found", message: "Route not found" } }, 404));
  return app;
}
