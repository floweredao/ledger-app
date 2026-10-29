import { Hono } from "hono";
import { nowKst } from "../../shared/dates";
import { type MonthNote, MonthNoteInputSchema, MonthNoteMonthSchema } from "../../shared/schema";
import { type AppBindings, readJson } from "../http";

export const monthNotesRoutes = new Hono<AppBindings>()
  .get("/month-notes/:yyyymm", (c) => {
    const month = MonthNoteMonthSchema.parse(c.req.param("yyyymm"));
    const note = c.get("db").query<MonthNote, [string]>("SELECT * FROM month_notes WHERE month=?").get(month);
    return c.json(note ?? { month, body: "", updated_at: null });
  })
  .put("/month-notes/:yyyymm", async (c) => {
    const month = MonthNoteMonthSchema.parse(c.req.param("yyyymm"));
    const { body } = await readJson(c, MonthNoteInputSchema);
    const db = c.get("db");
    if (body === "") {
      db.query("DELETE FROM month_notes WHERE month=?").run(month);
      return c.json({ month, body, updated_at: null });
    }
    const updated_at = nowKst();
    db.query(
      `INSERT INTO month_notes(month,body,updated_at) VALUES(?,?,?)
       ON CONFLICT(month) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at`,
    ).run(month, body, updated_at);
    return c.json({ month, body, updated_at });
  });
