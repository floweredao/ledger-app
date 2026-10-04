import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { nowKst } from "../../shared/dates";
import { merchantKey } from "../../shared/merchant";
import { TransactionListQuerySchema } from "../../shared/schema";
import { decodeCsv, EXPORT_HEADERS, encodeCsv, type ImportPlan, type ImportRow, parseImportTable } from "../domain/csv";
import { listTransactions } from "../domain/transactions";
import { defaultAssetId, insertTransaction } from "../domain/tx-core";
import { decodeXlsx, encodeXlsx } from "../domain/xlsx";
import { ApiError, type AppBindings, readJson } from "../http";

const MAX_FILE = 10 * 1024 * 1024;
type StoredPlan = { readonly plan: ImportPlan; readonly expires: number };
const previews = new WeakMap<Database, Map<string, StoredPlan>>();
const CommitSchema = z
  .object({
    preview_id: z.uuid(),
    include_duplicates: z.boolean().default(false),
  })
  .strict();

function duplicateKey(row: ImportRow): string {
  return JSON.stringify([
    Math.floor(Date.parse(row.input.occurred_at) / 60000),
    row.input.amount,
    merchantKey(row.input.merchant),
  ]);
}
function existingKeys(db: Database): Set<string> {
  return new Set(
    db
      .query<{ minute: number; amount: number; merchant_key: string }, []>(
        "SELECT CAST(strftime('%s',occurred_at) AS INTEGER)/60 AS minute,amount,merchant_key FROM transactions",
      )
      .all()
      .map((row) => JSON.stringify([row.minute, row.amount, row.merchant_key])),
  );
}
function sourceKey(row: ImportRow): string {
  return `imp:${createHash("sha256")
    .update(JSON.stringify([row.input, row.asset, row.destination, row.category, row.subcategory, row.hidden]))
    .digest("hex")}`;
}
function resolveAsset(db: Database, name: string): string | null {
  if (!name) return defaultAssetId(db);
  const found = db.query<{ id: string }, [string]>("SELECT id FROM assets WHERE name=? ORDER BY id LIMIT 1").get(name);
  if (found) return found.id;
  const id = Bun.randomUUIDv7();
  const now = nowKst();
  db.query("INSERT INTO assets(id,name,kind,created_at,updated_at) VALUES(?,?,'other',?,?)").run(id, name, now, now);
  return id;
}
function resolveCategory(db: Database, row: ImportRow): string | null {
  if (!row.category) return null;
  const type = row.input.type === "income" ? "income" : "expense";
  let parent: string | null = null;
  for (const name of [row.category, row.subcategory].filter(Boolean)) {
    const found = db
      .query<{ id: string }, [string, string, string | null]>(
        "SELECT id FROM categories WHERE type=? AND name=? AND parent_id IS ? ORDER BY id LIMIT 1",
      )
      .get(type, name, parent);
    if (found) parent = found.id;
    else {
      const id = Bun.randomUUIDv7();
      const now = nowKst();
      db.query("INSERT INTO categories(id,type,parent_id,name,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(
        id,
        type,
        parent,
        name,
        now,
        now,
      );
      parent = id;
    }
  }
  return parent;
}

export const ioRoutes = new Hono<AppBindings>();
ioRoutes.get("/export", (c) => {
  const format = z.enum(["csv", "xlsx"]).parse(c.req.query("format") ?? "csv");
  const query = TransactionListQuerySchema.parse(c.req.query());
  if (query.from) z.iso.date().parse(query.from);
  if (query.to) z.iso.date().parse(query.to);
  if (query.from && query.to && query.from > query.to) throw new ApiError(400, "invalid_range", "Invalid date range");
  const db = c.get("db");
  const assets = new Map(
    db
      .query<{ id: string; name: string }, []>("SELECT id,name FROM assets")
      .all()
      .map((row) => [row.id, row.name]),
  );
  const categories = new Map(
    db
      .query<{ id: string; name: string; parent_id: string | null }, []>("SELECT id,name,parent_id FROM categories")
      .all()
      .map((row) => [row.id, row]),
  );
  const rows: (string | number)[][] = [[...EXPORT_HEADERS]];
  let cursor = query.cursor;
  do {
    const page = listTransactions(db, { ...query, limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const row of page.items) {
      const local = new Date(Date.parse(row.occurred_at) + 9 * 3600000).toISOString();
      const category = row.category_id ? categories.get(row.category_id) : undefined;
      rows.push([
        local.slice(0, 10),
        local.slice(11, 19),
        { expense: "지출", income: "수입", transfer: "이체" }[row.type],
        category?.parent_id ? (categories.get(category.parent_id)?.name ?? "") : (category?.name ?? ""),
        category?.parent_id ? category.name : "",
        row.is_refund ? -row.amount : row.amount,
        row.currency,
        row.foreign_amount ?? "",
        row.asset_id ? (assets.get(row.asset_id) ?? "") : "",
        row.to_asset_id ? (assets.get(row.to_asset_id) ?? "") : "",
        row.merchant,
        row.memo,
        row.source,
        Number(row.hidden),
      ]);
    }
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  c.header(
    "Content-Disposition",
    `attachment; filename="ledger-${nowKst().slice(0, 10).replaceAll("-", "")}.${format}"`,
  );
  c.header(
    "Content-Type",
    format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  return c.body(format === "csv" ? encodeCsv(rows) : encodeXlsx(rows));
});

ioRoutes.post("/import/preview", async (c) => {
  const tooLarge = () => new ApiError(413, "too_large", "Import file exceeds 10 MiB");
  if (Number(c.req.header("content-length") ?? 0) > MAX_FILE + 65536) throw tooLarge();
  if (!c.req.header("content-type")?.startsWith("multipart/form-data;")) {
    throw new ApiError(415, "unsupported_media_type", "Expected multipart file upload");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (c.req.raw.body)
    for await (const chunk of c.req.raw.body) {
      size += chunk.byteLength;
      if (size > MAX_FILE + 65536) throw tooLarge();
      chunks.push(chunk);
    }
  let form: FormData;
  try {
    form = await new Response(Buffer.concat(chunks), {
      headers: { "Content-Type": c.req.header("content-type") ?? "" },
    }).formData();
  } catch (error) {
    if (error instanceof TypeError) throw new ApiError(400, "invalid_upload", "Malformed multipart upload");
    throw error;
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "invalid_upload", "File is required");
  if (file.size > MAX_FILE) throw tooLarge();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const table = bytes[0] === 0x50 && bytes[1] === 0x4b ? decodeXlsx(bytes) : decodeCsv(new TextDecoder().decode(bytes));
  const plan = parseImportTable(table);
  const db = c.get("db");
  const assets = new Map(
    db
      .query<{ id: string; name: string }, []>("SELECT id,name FROM assets")
      .all()
      .map((row) => [row.name, row.id]),
  );
  const keys = existingKeys(db);
  let duplicate = 0;
  const rows = plan.rows.map((row) => {
    const key = duplicateKey(row);
    const repeated =
      keys.has(key) || Boolean(db.query("SELECT 1 FROM transactions WHERE source_key=?").get(sourceKey(row)));
    keys.add(key);
    if (repeated) duplicate++;
    return {
      row: row.row,
      ...row.input,
      asset_id: row.asset ? (assets.get(row.asset) ?? null) : defaultAssetId(db),
      to_asset_id: assets.get(row.destination) ?? null,
      category_id:
        db
          .query<{ id: string }, [string, string, string]>(
            "SELECT c.id FROM categories c LEFT JOIN categories p ON p.id=c.parent_id WHERE c.type=? AND c.name=? AND COALESCE(p.name,'')=? ORDER BY c.id LIMIT 1",
          )
          .get(
            row.input.type === "income" ? "income" : "expense",
            row.subcategory || row.category,
            row.subcategory ? row.category : "",
          )?.id ?? null,
      asset_name: row.asset,
      to_asset_name: row.destination,
      category_name: row.category,
      subcategory_name: row.subcategory,
      hidden: row.hidden,
      duplicate: repeated,
    };
  });
  const stored = previews.get(db) ?? new Map<string, StoredPlan>();
  for (const [id, entry] of stored) if (entry.expires <= Date.now()) stored.delete(id);
  const previewId = Bun.randomUUIDv7();
  stored.set(previewId, { plan, expires: Date.now() + 15 * 60000 });
  previews.set(db, stored);
  return c.json({
    preview_id: previewId,
    detected_format: plan.detected_format,
    rows: rows.slice(0, 50),
    counts: { total: plan.total, new: plan.rows.length - duplicate, duplicate, error: plan.errors.length },
    errors: plan.errors,
  });
});

ioRoutes.post("/import/commit", async (c) => {
  const body = await readJson(c, CommitSchema);
  const db = c.get("db");
  const stored = previews.get(db);
  const entry = stored?.get(body.preview_id);
  if (!entry || entry.expires <= Date.now()) {
    stored?.delete(body.preview_id);
    throw new ApiError(404, "preview_not_found", "Preview not found or expired");
  }
  const result = db.transaction(() => {
    const keys = existingKeys(db);
    let inserted = 0;
    let skipped = entry.plan.errors.length;
    for (const row of entry.plan.rows) {
      const key = sourceKey(row);
      const duplicate = duplicateKey(row);
      if (
        db.query("SELECT 1 FROM transactions WHERE source_key=?").get(key) ||
        (!body.include_duplicates && keys.has(duplicate))
      ) {
        skipped++;
        continue;
      }
      const assetId = resolveAsset(db, row.asset);
      const destination = row.input.type === "transfer" ? resolveAsset(db, row.destination) : null;
      insertTransaction(
        db,
        { ...row.input, asset_id: assetId, to_asset_id: destination, category_id: resolveCategory(db, row) },
        { source: "import", source_key: key, hidden: row.hidden },
      );
      keys.add(duplicate);
      inserted++;
    }
    return { inserted, skipped };
  })();
  stored?.delete(body.preview_id);
  return c.json(result);
});
