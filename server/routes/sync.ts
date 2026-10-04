import { Hono } from "hono";
import type { AppBindings } from "../http";
import { ApiError } from "../http";

export const syncRoutes = new Hono<AppBindings>();

syncRoutes.get("/sync/status", async (c) => {
  const db = c.var.db;

  const lastRun = db.query("SELECT value FROM import_state WHERE key='last_run_at'").get() as
    | { value: string }
    | undefined;
  const lastResult = db.query("SELECT value FROM import_state WHERE key='last_result'").get() as
    | { value: string }
    | undefined;
  const lastError = db.query("SELECT value FROM import_state WHERE key='last_error'").get() as
    | { value: string }
    | undefined;
  const nextRun = db.query("SELECT value FROM import_state WHERE key='next_run_at'").get() as
    | { value: string }
    | undefined;

  return c.json({
    last_run_at: lastRun ? JSON.parse(lastRun.value) : null,
    last_result: lastResult ? JSON.parse(lastResult.value) : null,
    last_error: lastError ? JSON.parse(lastError.value) : null,
    next_run_at: nextRun ? JSON.parse(nextRun.value) : null,
  });
});

syncRoutes.post("/sync/run", async (c) => {
  const importer = c.var.importer;

  if (!importer) {
    throw new ApiError(503, "not_available", "Importer not configured");
  }

  const result = await importer.run();
  return c.json(result);
});
