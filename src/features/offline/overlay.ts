import { nowKst, toKstIso } from "../../../shared/dates";
import {
  type Transaction,
  TransactionInputSchema,
  TransactionListSchema,
  TransactionPatchSchema,
  TransactionSchema,
} from "../../../shared/schema";
import type { MutationRequest } from "../../api/outbox";

function createRow(request: MutationRequest): Transaction | undefined {
  if (request.method !== "POST" || request.path !== "transactions") return undefined;
  const parsed = TransactionInputSchema.safeParse(request.body);
  if (!parsed.success || !parsed.data.id) return undefined;
  const input = parsed.data;
  const occurredAt = toKstIso(new Date(input.occurred_at));
  return {
    ...input,
    id: parsed.data.id,
    occurred_at: occurredAt,
    foreign_amount: input.foreign_amount ?? null,
    asset_id: input.asset_id ?? null,
    to_asset_id: input.to_asset_id ?? null,
    category_id: input.category_id ?? null,
    merchant_key: input.merchant.trim().toLowerCase(),
    source: "manual",
    source_key: null,
    src_account: null,
    src_amount: null,
    src_at: null,
    hidden: false,
    hidden_reason: null,
    user_locked: [],
    recurring_rule_id: null,
    deleted_at: null,
    created_at: occurredAt,
    updated_at: occurredAt,
  };
}

function matches(row: Transaction, query: URLSearchParams, previous?: Transaction): boolean {
  if (row.deleted_at) return false;
  const date = toKstIso(new Date(row.occurred_at)).slice(0, 10);
  const from = query.get("from");
  const to = query.get("to");
  if ((from && date < from) || (to && date > to)) return false;
  for (const field of ["type", "category_id", "source"] as const) {
    if (field === "category_id" && query.get(field) === "uncategorized") {
      if (row.category_id !== null) return false;
      continue;
    }
    if (field === "category_id" && previous && previous[field] === row[field]) continue;
    const value = query.get(field);
    if (value && value !== row[field]) return false;
  }
  const asset = query.get("asset_id");
  const sameAsset = previous && previous.asset_id === row.asset_id && previous.to_asset_id === row.to_asset_id;
  if (asset && !sameAsset && asset !== row.asset_id && asset !== row.to_asset_id) return false;
  const hidden = query.get("hidden") ?? "exclude";
  if ((hidden === "only" && !row.hidden) || (hidden === "exclude" && row.hidden)) return false;
  const min = query.get("min");
  const max = query.get("max");
  if ((min && row.amount < Number(min)) || (max && row.amount > Number(max))) return false;
  const q = query.get("q")?.toLowerCase();
  return !q || (row.merchant + " " + row.memo).toLowerCase().includes(q);
}

/** Project the ordered durable queue without changing cached server responses. */
export function overlayTransactions<T>(
  key: string,
  data: T,
  pending: readonly (MutationRequest & { readonly base?: Transaction })[],
): T {
  const path = key.split("?")[0] ?? "";
  const detail = /^transactions\/([^/]+)$/.exec(path);
  if ((path !== "transactions" && !detail) || pending.length === 0) return data;
  const list = TransactionListSchema.safeParse(data);
  const single = TransactionSchema.safeParse(data);
  if (!detail && !list.success) return data;
  const originals = new Map<string, Transaction>();
  if (detail && single.success) originals.set(encodeURIComponent(single.data.id), single.data);
  if (!detail && list.success) for (const row of list.data.items) originals.set(encodeURIComponent(row.id), row);
  const rows = new Map(originals);
  const changed = new Set<string>();
  for (const request of pending) {
    const created = createRow(request);
    if (created) {
      const id = encodeURIComponent(created.id);
      if (!rows.has(id)) {
        rows.set(id, created);
        changed.add(id);
      }
      continue;
    }
    const target = /^transactions\/([^/]+)(\/restore)?$/.exec(request.path);
    const id = target?.[1];
    if (!id) continue;
    if (!rows.has(id) && request.base) {
      rows.set(id, request.base);
      if (
        !detail &&
        list.success &&
        list.data.totals.count > list.data.items.length &&
        matches(request.base, new URLSearchParams(key.split("?")[1]))
      ) {
        originals.set(id, request.base);
      }
    }
    const current = rows.get(id);
    if (!current) continue;
    if (request.method === "PATCH" && !target?.[2]) {
      const parsed = TransactionPatchSchema.safeParse(request.body);
      if (!parsed.success) continue;
      const fields = Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined));
      const projected = { ...current, ...fields };
      if (parsed.data.occurred_at) projected.occurred_at = toKstIso(new Date(parsed.data.occurred_at));
      rows.set(id, TransactionSchema.parse(projected));
    } else if (request.method === "DELETE" && !target?.[2]) {
      rows.set(id, { ...current, deleted_at: nowKst() });
    } else if (request.method === "POST" && target?.[2]) {
      rows.set(id, { ...current, deleted_at: null });
    } else continue;
    changed.add(id);
  }
  if (detail) {
    const projected = rows.get(detail[1] ?? "");
    return projected ? Object.assign({}, data, projected) : data;
  }
  if (!list.success || changed.size === 0) return data;
  const query = new URLSearchParams(key.split("?")[1]);
  const visible = new Map([...rows].filter(([id, row]) => !changed.has(id) || matches(row, query, originals.get(id))));
  const totals = { ...list.data.totals };
  const adjust = (row: Transaction, direction: number) => {
    if (row.type === "income") totals.income += direction * row.amount;
    if (row.type === "expense") totals.expense += direction * (row.is_refund ? -row.amount : row.amount);
    totals.count += direction;
  };
  for (const id of changed) {
    const before = originals.get(id);
    const after = visible.get(id);
    if (before) adjust(before, -1);
    if (after) adjust(after, 1);
  }
  totals.net = totals.income - totals.expense;
  const items = [...visible.values()].sort(
    (a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.id.localeCompare(a.id),
  );
  return Object.assign({}, data, { items, totals });
}
