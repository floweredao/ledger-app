import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { DEFAULT_SETTINGS, type Settings, SettingsPatchSchema, SettingsSchema } from "../../shared/schema";
import { ApiError, type AppBindings, readJson } from "../http";

export const settingsRoutes = new Hono<AppBindings>();

function getSettings(db: Database): Settings {
  const rows = db.query<{ key: string; value: string }, []>("SELECT key,value FROM settings").all();
  return SettingsSchema.parse({
    ...DEFAULT_SETTINGS,
    ...Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value)])),
  });
}

settingsRoutes.get("/settings", (c) => c.json(getSettings(c.var.db)));
settingsRoutes.patch("/settings", async (c) => {
  const { db, importer } = c.var;
  const patch = await readJson(c, SettingsPatchSchema);
  const current = getSettings(db);
  if (patch.default_asset_id != null && !db.query("SELECT 1 FROM assets WHERE id=?").get(patch.default_asset_id)) {
    throw new ApiError(400, "invalid_input", "Asset not found");
  }
  db.transaction(() => {
    const statement = db.query(
      "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    );
    for (const [key, value] of Object.entries(patch)) statement.run(key, JSON.stringify(value));
    if (patch.owner_name !== undefined && patch.owner_name !== current.owner_name) importer?.reclassify();
  }).immediate();
  return c.json(getSettings(db));
});
