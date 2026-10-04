import { Hono } from "hono";
import { z } from "zod";
import { AssetInputSchema, AssetPatchSchema } from "../../shared/schema";
import { assetSummary, CardPaymentSchema, cardPayment, createAsset, deleteAsset, patchAsset } from "../domain/assets";
import { type AppBindings, readJson } from "../http";

// Zod applies defaults inside optional fields; PATCH must leave omitted fields untouched.
const PatchSchema = AssetPatchSchema.extend({
  group_name: AssetInputSchema.shape.group_name.removeDefault().optional(),
  opening_balance: AssetInputSchema.shape.opening_balance.removeDefault().optional(),
  hidden: AssetInputSchema.shape.hidden.removeDefault().optional(),
});
const HiddenQuerySchema = z.object({ include_hidden: z.enum(["true", "false", "1", "0"]).optional() });
const includeHidden = (query: Record<string, string>) => {
  const value = HiddenQuerySchema.parse(query).include_hidden;
  return value === "true" || value === "1";
};

export const assetsRoutes = new Hono<AppBindings>()
  .get("/assets", (c) => c.json({ items: assetSummary(c.var.db, undefined, includeHidden(c.req.query())).assets }))
  .post("/assets", async (c) => c.json(createAsset(c.var.db, await readJson(c, AssetInputSchema)), 201))
  .get("/assets/summary", (c) => c.json(assetSummary(c.var.db, undefined, includeHidden(c.req.query()))))
  .patch("/assets/:id", async (c) => c.json(patchAsset(c.var.db, c.req.param("id"), await readJson(c, PatchSchema))))
  .delete("/assets/:id", (c) => {
    deleteAsset(c.var.db, c.req.param("id"));
    return c.json({ ok: true });
  })
  .post("/assets/:id/card-payment", async (c) =>
    c.json(cardPayment(c.var.db, c.req.param("id"), await readJson(c, CardPaymentSchema)), 201),
  );
