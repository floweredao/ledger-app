import type { Context } from "hono";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { nowKst, toKstIso } from "../../shared/dates";
import { TransactionInputSchema, TransactionListQuerySchema, TransactionPatchSchema } from "../../shared/schema";
import {
  createTransaction,
  deleteTransaction,
  listTransactions,
  restoreTransaction,
  updateTransaction,
} from "../domain/transactions";
import { getTransaction } from "../domain/tx-core";
import { ApiError, type AppBindings, readJson } from "../http";

type SavedResponse = { status: number; body: string };

function mutate(c: Context<AppBindings>, status: ContentfulStatusCode, operation: () => unknown) {
  const db = c.get("db");
  const key = c.req.header("idempotency-key");
  if (key !== undefined && (key.length === 0 || key.length > 200)) {
    throw new ApiError(400, "invalid_idempotency_key", "Idempotency-Key must contain 1 to 200 characters");
  }
  const method = c.req.method;
  const path = c.req.path;
  const write = db.transaction((): SavedResponse => {
    if (key !== undefined) {
      const saved = db
        .query<SavedResponse, [string, string, string]>(
          "SELECT status,body FROM idempotency WHERE key=? AND method=? AND path=?",
        )
        .get(key, method, path);
      if (saved) return saved;
    }
    const now = nowKst();
    db.query("DELETE FROM idempotency WHERE created_at < ?").run(
      toKstIso(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
    );
    const body = JSON.stringify(operation());
    if (key !== undefined) {
      db.query("INSERT INTO idempotency(key,method,path,status,body,created_at) VALUES(?,?,?,?,?,?)").run(
        key,
        method,
        path,
        status,
        body,
        now,
      );
    }
    return { status, body };
  });
  const saved = write();
  return c.body(saved.body, saved.status as ContentfulStatusCode, { "Content-Type": "application/json" });
}

const ListQuerySchema = TransactionListQuerySchema.extend({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
}).superRefine((query, context) => {
  if (query.from && query.to && query.from > query.to) {
    context.addIssue({ code: "custom", message: "from must not be after to", path: ["from"] });
  }
  if (query.min !== undefined && query.max !== undefined && query.min > query.max) {
    context.addIssue({ code: "custom", message: "min must not exceed max", path: ["min"] });
  }
});

export const transactionsRoutes = new Hono<AppBindings>()
  .get("/transactions", (c) => {
    const query = ListQuerySchema.parse(c.req.query());
    return c.json(listTransactions(c.get("db"), query));
  })
  .get("/transactions/:id", (c) => {
    const transaction = getTransaction(c.get("db"), c.req.param("id"));
    if (!transaction) throw new ApiError(404, "not_found", "Transaction not found");
    return c.json(transaction);
  })
  .post("/transactions", async (c) => {
    const input = await readJson(c, TransactionInputSchema);
    return mutate(c, 201, () => createTransaction(c.get("db"), input));
  })
  .patch("/transactions/:id", async (c) => {
    const patch = await readJson(c, TransactionPatchSchema);
    return mutate(c, 200, () => {
      const result = updateTransaction(c.get("db"), c.req.param("id"), patch);
      return { ...result.transaction, applied_count: result.applied_count };
    });
  })
  .delete("/transactions/:id", (c) => mutate(c, 200, () => deleteTransaction(c.get("db"), c.req.param("id"))))
  .post("/transactions/:id/restore", (c) => mutate(c, 200, () => restoreTransaction(c.get("db"), c.req.param("id"))));
