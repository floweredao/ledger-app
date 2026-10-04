import { Hono } from "hono";
import { z } from "zod";
import { BudgetPutSchema } from "../../shared/schema";
import { deleteBudget, getBudgetStatus, upsertBudget } from "../domain/budgets";
import { ApiError, type AppBindings, readJson } from "../http";

const monthQuery = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const idParam = z.string().min(1);

export const budgetsRoutes = new Hono<AppBindings>()
  .get("/budgets", (c) => {
    const month = monthQuery.parse(c.req.query("month"));
    return c.json(getBudgetStatus(c.get("db"), month));
  })
  .put("/budgets", async (c) => {
    const parsed = await readJson(c, BudgetPutSchema);
    const input = {
      ...parsed,
      category_id: parsed.category_id ?? "",
      month: parsed.month ?? "",
    };
    if (
      input.category_id !== "" &&
      !c.get("db").query("SELECT 1 FROM categories WHERE id=? AND type='expense'").get(input.category_id)
    ) {
      throw new ApiError(400, "invalid_category", "Budget category not found");
    }
    return c.json(upsertBudget(c.get("db"), input));
  })
  .delete("/budgets/:id", (c) => {
    const id = idParam.parse(c.req.param("id"));
    if (!deleteBudget(c.get("db"), id)) throw new ApiError(404, "not_found", "Budget not found");
    return c.json({ ok: true });
  });
