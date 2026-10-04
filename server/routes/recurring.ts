import { Hono } from "hono";
import { z } from "zod";
import { nowKst } from "../../shared/dates";
import { RecurringInputSchema, RecurringPatchSchema, RecurringRuleSchema } from "../../shared/schema";
import { materialize, validateTemplateReferences } from "../domain/recurring";
import { ApiError, type AppBindings, readJson } from "../http";

const RunSchema = z.object({ today: z.iso.date().optional() }).strict();
const RuleIdSchema = z.uuid();
const ruleView = (row: Record<string, unknown>) =>
  RecurringRuleSchema.parse({
    ...row,
    template: JSON.parse(String(row.template)),
    active: row.active === 1,
  });

export const recurringRoutes = new Hono<AppBindings>()
  .get("/recurring", (c) => {
    const rows = c.get("db").query("SELECT * FROM recurring_rules ORDER BY created_at, id").all() as Record<
      string,
      unknown
    >[];
    return c.json({ items: rows.map(ruleView) });
  })
  .post("/recurring", async (c) => {
    const input = await readJson(c, RecurringInputSchema);
    const db = c.get("db");
    validateTemplateReferences(db, input.template);
    const id = Bun.randomUUIDv7();
    const now = nowKst();
    db.query(
      "INSERT INTO recurring_rules(id,template,freq,interval,start_date,end_date,last_materialized_date,active,created_at,updated_at) VALUES(?,?,?,?,?,?,NULL,?,?,?)",
    ).run(
      id,
      JSON.stringify(input.template),
      input.freq,
      input.interval,
      input.start_date,
      input.end_date ?? null,
      Number(input.active),
      now,
      now,
    );
    return c.json(
      ruleView(db.query("SELECT * FROM recurring_rules WHERE id=?").get(id) as Record<string, unknown>),
      201,
    );
  })
  .post("/recurring/run", async (c) => {
    const body = c.req.raw.body ? await readJson(c, RunSchema) : {};
    return c.json({ created: materialize(c.get("db"), body.today) });
  })
  .patch("/recurring/:id", async (c) => {
    const id = RuleIdSchema.parse(c.req.param("id"));
    const patch = await readJson(c, RecurringPatchSchema);
    const db = c.get("db");
    const current = db.query<Record<string, unknown>, [string]>("SELECT * FROM recurring_rules WHERE id=?").get(id);
    if (!current) {
      throw new ApiError(404, "not_found", "Recurring rule not found");
    }
    validateTemplateReferences(db, patch.template ?? ruleView(current).template);
    const columns: [string, string | number | null][] = [];
    if (patch.template !== undefined) columns.push(["template", JSON.stringify(patch.template)]);
    if (patch.freq !== undefined) columns.push(["freq", patch.freq]);
    if (patch.interval !== undefined) columns.push(["interval", patch.interval]);
    if (patch.start_date !== undefined) columns.push(["start_date", patch.start_date]);
    if (patch.end_date !== undefined) columns.push(["end_date", patch.end_date]);
    if (patch.active !== undefined) columns.push(["active", Number(patch.active)]);
    if (columns.length > 0) {
      columns.push(["updated_at", nowKst()]);
      db.query(`UPDATE recurring_rules SET ${columns.map(([column]) => `${column}=?`).join(",")} WHERE id=?`).run(
        ...columns.map(([, value]) => value),
        id,
      );
    }
    return c.json(ruleView(db.query("SELECT * FROM recurring_rules WHERE id=?").get(id) as Record<string, unknown>));
  })
  .delete("/recurring/:id", (c) => {
    const id = RuleIdSchema.parse(c.req.param("id"));
    const db = c.get("db");
    if (!db.query("SELECT 1 FROM recurring_rules WHERE id=?").get(id)) {
      throw new ApiError(404, "not_found", "Recurring rule not found");
    }
    db.query("DELETE FROM recurring_rules WHERE id=?").run(id);
    return c.json({ ok: true });
  });
