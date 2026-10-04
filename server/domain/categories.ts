import type { Database } from "bun:sqlite";
import { nowKst } from "../../shared/dates";
import {
  type Category,
  CategoryInputSchema,
  CategoryPatchSchema,
  CategorySchema,
  type CategoryType,
  MerchantRuleSchema,
  ReorderSchema,
} from "../../shared/schema";
import { ApiError } from "../http";

function getCategory(db: Database, id: string): Category {
  const row = db
    .query(
      "SELECT id,type,parent_id,name,icon,color,sort,hidden=1 AS hidden,created_at,updated_at FROM categories WHERE id=?",
    )
    .get(id);
  if (!row) throw new ApiError(404, "not_found", "Category not found");
  const value = row as unknown as Record<string, unknown>;
  return CategorySchema.parse({ ...value, hidden: Boolean(value.hidden) });
}

function validateParent(db: Database, type: CategoryType, parentId: string | null): void {
  if (parentId === null) return;
  const parent = getCategory(db, parentId);
  if (parent.type !== type) throw new ApiError(400, "invalid_parent", "Parent category must have the same type");
  if (parent.parent_id !== null) throw new ApiError(400, "max_depth", "Categories can have at most two levels");
}

function duplicateName(db: Database, type: CategoryType, parentId: string | null, name: string, exceptId?: string) {
  const row = db
    .query<{ id: string }, [string, string | null, string, string]>(
      "SELECT id FROM categories WHERE type=? AND parent_id IS ? AND name=? AND id<>?",
    )
    .get(type, parentId, name, exceptId ?? "");
  if (row) throw new ApiError(409, "conflict", "A category with this name already exists");
}

export function listCategories(
  db: Database,
  options: { readonly type?: CategoryType; readonly includeHidden: boolean },
): Array<Category & { children: Category[] }> {
  const rows = db
    .query(
      "SELECT id,type,parent_id,name,icon,color,sort,hidden=1 AS hidden,created_at,updated_at FROM categories WHERE (? IS NULL OR type=?) AND (?=1 OR hidden=0) ORDER BY type, parent_id IS NOT NULL, sort, name",
    )
    .all(options.type ?? null, options.type ?? null, Number(options.includeHidden));
  const categories = rows.map((row) => {
    const value = row as unknown as Record<string, unknown>;
    return CategorySchema.parse({ ...value, hidden: Boolean(value.hidden) });
  });
  const nodes = new Map<string, Category & { children: Category[] }>();
  for (const category of categories) nodes.set(category.id, { ...category, children: [] });
  const roots: Array<Category & { children: Category[] }> = [];
  for (const node of nodes.values()) {
    if (node.parent_id === null) roots.push(node);
    else nodes.get(node.parent_id)?.children.push(node);
  }
  return roots;
}

export function createCategory(db: Database, value: unknown): Category {
  const input = CategoryInputSchema.parse(value);
  const parentId = input.parent_id ?? null;
  validateParent(db, input.type, parentId);
  duplicateName(db, input.type, parentId, input.name);
  const sort =
    db
      .query<{ next_sort: number }, [string, string | null]>(
        "SELECT COALESCE(MAX(sort),-1)+1 AS next_sort FROM categories WHERE type=? AND parent_id IS ?",
      )
      .get(input.type, parentId)?.next_sort ?? 0;
  const id = Bun.randomUUIDv7();
  const now = nowKst();
  db.query(
    "INSERT INTO categories(id,type,parent_id,name,icon,color,sort,hidden,created_at,updated_at) VALUES(?,?,?,?,?,?,?,0,?,?)",
  ).run(id, input.type, parentId, input.name, input.icon ?? null, input.color ?? null, sort, now, now);
  return getCategory(db, id);
}

export function patchCategory(db: Database, id: string, value: unknown): Category {
  const patch = CategoryPatchSchema.parse(value);
  const current = getCategory(db, id);
  const nextType = current.type;
  const nextParent = patch.parent_id === undefined ? current.parent_id : patch.parent_id;
  if (nextParent === id) throw new ApiError(400, "invalid_parent", "A category cannot be its own parent");
  validateParent(db, nextType, nextParent);
  if (nextParent !== current.parent_id) {
    const descendant = db.query("SELECT 1 FROM categories WHERE parent_id=? LIMIT 1").get(id);
    if (descendant) throw new ApiError(400, "max_depth", "A category with children cannot become a child");
  }
  const nextName = patch.name ?? current.name;
  duplicateName(db, nextType, nextParent, nextName, id);
  const fields = ["name", "icon", "color", "hidden", "sort", "parent_id"] as const;
  const changed = fields.filter((field) => patch[field] !== undefined && patch[field] !== current[field]);
  if (changed.length) {
    const columns = changed.map((field) => `${field}=?`);
    const values = changed.map((field) => {
      const value = patch[field];
      return field === "hidden" ? Number(value) : (value ?? null);
    });
    db.query(`UPDATE categories SET ${columns.join(",")},updated_at=? WHERE id=?`).run(...values, nowKst(), id);
  }
  return getCategory(db, id);
}

export function reorderCategories(db: Database, value: unknown): void {
  const { ids } = ReorderSchema.parse(value);
  if (new Set(ids).size !== ids.length) throw new ApiError(400, "invalid_reorder", "Category ids must be unique");
  const categories = ids.map((id) => getCategory(db, id));
  const first = categories[0];
  if (first && categories.some((category) => category.type !== first.type || category.parent_id !== first.parent_id)) {
    throw new ApiError(400, "invalid_reorder", "Categories must be siblings of the same type");
  }
  const update = db.query("UPDATE categories SET sort=?,updated_at=? WHERE id=?");
  const now = nowKst();
  db.transaction(() => {
    for (const [sort, id] of ids.entries()) update.run(sort, now, id);
  }).immediate();
}

export function deleteCategory(db: Database, id: string, reassignTo?: string): void {
  const category = getCategory(db, id);
  const childRows = db.query<{ id: string }, [string]>("SELECT id FROM categories WHERE parent_id=?").all(id);
  const hasRefs = (categoryId: string) =>
    Boolean(
      db.query("SELECT 1 FROM transactions WHERE category_id=? LIMIT 1").get(categoryId) ||
        db.query("SELECT 1 FROM budgets WHERE category_id=? LIMIT 1").get(categoryId) ||
        db.query("SELECT 1 FROM merchant_rules WHERE category_id=? LIMIT 1").get(categoryId) ||
        db
          .query("SELECT 1 FROM recurring_rules WHERE json_extract(template,'$.category_id')=? LIMIT 1")
          .get(categoryId) ||
        db.query("SELECT 1 FROM templates WHERE json_extract(payload,'$.category_id')=? LIMIT 1").get(categoryId),
    );
  if (!reassignTo) {
    if (childRows.length || hasRefs(id)) throw new ApiError(409, "in_use", "Category is referenced by other data");
    db.query("DELETE FROM categories WHERE id=?").run(id);
    return;
  }
  const target = getCategory(db, reassignTo);
  if (target.id === id || target.type !== category.type) {
    throw new ApiError(400, "invalid_reassign", "Reassignment target must be a different category of the same type");
  }
  const descendants = childRows.map((row) => row.id);
  if (descendants.includes(target.id) || (descendants.length > 0 && target.parent_id !== null)) {
    throw new ApiError(400, "invalid_reassign", "Cannot move child categories below another child category");
  }
  for (const childId of descendants) {
    const child = getCategory(db, childId);
    duplicateName(db, category.type, target.id, child.name, childId);
  }
  const sources = [id];
  db.transaction(() => {
    for (const sourceId of sources) {
      db.query(
        "UPDATE recurring_rules SET template=json_set(template,'$.category_id',?),updated_at=? WHERE json_extract(template,'$.category_id')=?",
      ).run(target.id, nowKst(), sourceId);
      db.query(
        "UPDATE templates SET payload=json_set(payload,'$.category_id',?),updated_at=? WHERE json_extract(payload,'$.category_id')=?",
      ).run(target.id, nowKst(), sourceId);
      db.query("UPDATE transactions SET category_id=?,updated_at=? WHERE category_id=?").run(
        target.id,
        nowKst(),
        sourceId,
      );
      const budgets = db
        .query<{ month: string; amount: number }, [string]>("SELECT month,amount FROM budgets WHERE category_id=?")
        .all(sourceId);
      for (const budget of budgets) {
        db.query(
          `INSERT INTO budgets(id,category_id,month,amount) VALUES(?,?,?,?)
           ON CONFLICT(category_id,month) DO UPDATE SET amount=amount+excluded.amount`,
        ).run(Bun.randomUUIDv7(), target.id, budget.month, budget.amount);
      }
      db.query("DELETE FROM budgets WHERE category_id=?").run(sourceId);
      const rules = db
        .query<{ merchant_key: string; type: string; updated_at: string }, [string]>(
          "SELECT merchant_key,type,updated_at FROM merchant_rules WHERE category_id=?",
        )
        .all(sourceId);
      for (const rule of rules) {
        db.query(
          `INSERT INTO merchant_rules(merchant_key,category_id,type,updated_at) VALUES(?,?,?,?)
           ON CONFLICT(merchant_key,type) DO UPDATE SET category_id=excluded.category_id,updated_at=excluded.updated_at`,
        ).run(rule.merchant_key, target.id, rule.type, rule.updated_at);
      }
      db.query("DELETE FROM merchant_rules WHERE category_id=?").run(sourceId);
    }
    if (descendants.length) {
      const placeholders = descendants.map(() => "?").join(",");
      db.query(`UPDATE categories SET parent_id=?,updated_at=? WHERE id IN (${placeholders})`).run(
        target.id,
        nowKst(),
        ...descendants,
      );
    }
    db.query("DELETE FROM categories WHERE id=?").run(id);
  }).immediate();
}

export function listMerchantRules(db: Database) {
  return db
    .query(
      `SELECT r.merchant_key,r.category_id,c.name AS category_name,r.type,r.updated_at
       FROM merchant_rules r JOIN categories c ON c.id=r.category_id
       ORDER BY r.merchant_key,r.type`,
    )
    .all()
    .map((row) => MerchantRuleSchema.parse(row));
}

export function deleteMerchantRule(db: Database, merchantKey: string, type?: CategoryType): boolean {
  const result = type
    ? db.query("DELETE FROM merchant_rules WHERE merchant_key=? AND type=?").run(merchantKey, type)
    : db.query("DELETE FROM merchant_rules WHERE merchant_key=?").run(merchantKey);
  return result.changes > 0;
}
