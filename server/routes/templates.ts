import { Hono } from "hono";
import { z } from "zod";
import { nowKst } from "../../shared/dates";
import {
  TemplateInputSchema,
  TemplatePatchSchema,
  TemplateSchema,
  TransactionInputSchema,
  TransactionPatchSchema,
} from "../../shared/schema";
import { validateTemplateReferences } from "../domain/recurring";
import { insertTransaction } from "../domain/tx-core";
import { ApiError, type AppBindings, readJson } from "../http";

const TemplateIdSchema = z.uuid();
const UseOverridesSchema = TransactionPatchSchema.pick({
  occurred_at: true,
  amount: true,
  is_refund: true,
  currency: true,
  foreign_amount: true,
  krw_status: true,
  asset_id: true,
  to_asset_id: true,
  category_id: true,
  merchant: true,
  memo: true,
})
  .partial()
  .strict();
const templateView = (row: Record<string, unknown>) =>
  TemplateSchema.parse({ ...row, payload: JSON.parse(String(row.payload)) });

export const templatesRoutes = new Hono<AppBindings>()
  .get("/templates", (c) => {
    const rows = c
      .get("db")
      .query("SELECT * FROM templates ORDER BY sort, use_count DESC, created_at, id")
      .all() as Record<string, unknown>[];
    return c.json({ items: rows.map(templateView) });
  })
  .post("/templates", async (c) => {
    const input = await readJson(c, TemplateInputSchema);
    const db = c.get("db");
    validateTemplateReferences(db, input.payload);
    const id = Bun.randomUUIDv7();
    const now = nowKst();
    db.query("INSERT INTO templates(id,name,payload,sort,use_count,created_at,updated_at) VALUES(?,?,?,?,0,?,?)").run(
      id,
      input.name,
      JSON.stringify(input.payload),
      input.sort ?? 0,
      now,
      now,
    );
    return c.json(templateView(db.query("SELECT * FROM templates WHERE id=?").get(id) as Record<string, unknown>), 201);
  })
  .patch("/templates/:id", async (c) => {
    const id = TemplateIdSchema.parse(c.req.param("id"));
    const patch = await readJson(c, TemplatePatchSchema);
    const db = c.get("db");
    const current = db.query<Record<string, unknown>, [string]>("SELECT * FROM templates WHERE id=?").get(id);
    if (!current) {
      throw new ApiError(404, "not_found", "Template not found");
    }
    validateTemplateReferences(db, patch.payload ?? templateView(current).payload);
    const columns: [string, string | number][] = [];
    if (patch.name !== undefined) columns.push(["name", patch.name]);
    if (patch.payload !== undefined) columns.push(["payload", JSON.stringify(patch.payload)]);
    if (patch.sort !== undefined) columns.push(["sort", patch.sort]);
    if (columns.length > 0) {
      columns.push(["updated_at", nowKst()]);
      db.query(`UPDATE templates SET ${columns.map(([column]) => `${column}=?`).join(",")} WHERE id=?`).run(
        ...columns.map(([, value]) => value),
        id,
      );
    }
    return c.json(templateView(db.query("SELECT * FROM templates WHERE id=?").get(id) as Record<string, unknown>));
  })
  .delete("/templates/:id", (c) => {
    const id = TemplateIdSchema.parse(c.req.param("id"));
    const db = c.get("db");
    if (!db.query("SELECT 1 FROM templates WHERE id=?").get(id)) {
      throw new ApiError(404, "not_found", "Template not found");
    }
    db.query("DELETE FROM templates WHERE id=?").run(id);
    return c.json({ ok: true });
  })
  .post("/templates/:id/use", async (c) => {
    const id = TemplateIdSchema.parse(c.req.param("id"));
    const overrides = c.req.raw.body ? await readJson(c, UseOverridesSchema) : {};
    const db = c.get("db");
    const row = db.query<{ payload: string }, [string]>("SELECT payload FROM templates WHERE id=?").get(id);
    if (!row) throw new ApiError(404, "not_found", "Template not found");
    const payload = JSON.parse(row.payload);
    const input = TransactionInputSchema.parse({
      ...payload,
      ...overrides,
      occurred_at: overrides.occurred_at ?? nowKst(),
    });
    const create = db.transaction(() => {
      const transaction = insertTransaction(db, input, { now: nowKst() });
      db.query("UPDATE templates SET use_count=use_count+1,updated_at=? WHERE id=?").run(nowKst(), id);
      return transaction;
    });
    return c.json(create.immediate(), 201);
  });
