import { Hono } from "hono";
import { z } from "zod";
import { exportBackup, restoreBackup } from "../domain/backup";
import type { AppBindings } from "../http";
import { ApiError, readJson } from "../http";

export const backupRoutes = new Hono<AppBindings>();

backupRoutes.get("/backup", async (c) => {
  const db = c.var.db;
  const exported = exportBackup(db);
  return c.json(exported);
});

backupRoutes.post("/backup/restore", async (c) => {
  const confirm = c.req.query("confirm");
  if (confirm !== "REPLACE") {
    throw new ApiError(400, "invalid_request", "Missing or invalid ?confirm=REPLACE parameter");
  }

  const db = c.var.db;
  const dataDir = c.var.config.LEDGER_DATA_DIR;

  const body = await readJson(c, z.unknown(), 50 * 1024 * 1024);

  restoreBackup(db, body, dataDir);

  return c.json({ ok: true });
});
