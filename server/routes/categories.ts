import { Hono } from "hono";
import {
  CategoryInputSchema,
  CategoryPatchSchema,
  type CategoryType,
  CategoryTypeSchema,
  ReorderSchema,
} from "../../shared/schema";
import {
  categoryUsage,
  createCategory,
  deleteCategory,
  deleteMerchantRule,
  listCategories,
  listMerchantRules,
  patchCategory,
  reorderCategories,
} from "../domain/categories";
import { ApiError, type AppBindings, readJson } from "../http";

function queryType(value: string | undefined): CategoryType | undefined {
  if (value === undefined) return undefined;
  return CategoryTypeSchema.parse(value);
}

function queryFlag(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new ApiError(400, "invalid_query", "Expected a boolean query value");
}

export const categoriesRoutes = new Hono<AppBindings>()
  .get("/categories", (c) => {
    const type = queryType(c.req.query("type"));
    const includeHidden = queryFlag(c.req.query("include_hidden"));
    return c.json({ items: listCategories(c.get("db"), { ...(type ? { type } : {}), includeHidden }) });
  })
  .post("/categories", async (c) => c.json(createCategory(c.get("db"), await readJson(c, CategoryInputSchema)), 201))
  .post("/categories/reorder", async (c) => {
    reorderCategories(c.get("db"), await readJson(c, ReorderSchema));
    return c.json({ ok: true });
  })
  .patch("/categories/:id", async (c) => {
    return c.json(patchCategory(c.get("db"), c.req.param("id"), await readJson(c, CategoryPatchSchema)));
  })
  .get("/categories/:id/usage", (c) => c.json(categoryUsage(c.get("db"), c.req.param("id"))))
  .delete("/categories/:id", (c) => {
    return c.json({ ok: true, ...deleteCategory(c.get("db"), c.req.param("id"), c.req.query("reassign_to")) });
  })
  .get("/merchant-rules", (c) => c.json({ items: listMerchantRules(c.get("db")) }))
  .delete("/merchant-rules/:key", (c) => {
    const type = queryType(c.req.query("type"));
    const key = decodeURIComponent(c.req.param("key"));
    if (!deleteMerchantRule(c.get("db"), key, type)) throw new ApiError(404, "not_found", "Merchant rule not found");
    return c.json({ ok: true });
  });
