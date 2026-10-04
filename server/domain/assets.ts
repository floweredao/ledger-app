import type { Database } from "bun:sqlite";
import { z } from "zod";
import { addDays, addMonths, daysInMonth, kstDate, nowKst } from "../../shared/dates";
import {
  type Asset,
  type AssetInput,
  type AssetPatch,
  AssetSchema,
  type AssetSummary,
  MAX_AMOUNT,
  TransactionInputSchema,
} from "../../shared/schema";
import { ApiError } from "../http";
import { insertTransaction } from "./tx-core";

const AssetRowSchema = AssetSchema.extend({ hidden: z.number().transform((value) => value === 1) });
export const CardPaymentSchema = z
  .object({
    amount: z.number().int().positive().max(MAX_AMOUNT).optional(),
    date: z.iso.date().optional(),
  })
  .strict();
type CardPaymentInput = z.infer<typeof CardPaymentSchema>;
type Cycle = { readonly from: string; readonly to: string };
type Flow = {
  readonly type: "expense" | "income" | "transfer";
  readonly amount: number;
  readonly is_refund: number;
  readonly asset_id: string | null;
  readonly to_asset_id: string | null;
  readonly occurred_at: string;
};

function requireAsset(db: Database, id: string): Asset {
  const row = db.query("SELECT * FROM assets WHERE id=?").get(id);
  if (!row) throw new ApiError(404, "not_found", "Asset not found");
  return AssetRowSchema.parse(row);
}

function validateAsset(db: Database, asset: Asset): void {
  const card = asset.kind === "check_card" || asset.kind === "credit_card";
  if (
    !card &&
    [asset.linked_asset_id, asset.settlement_day, asset.payment_day, asset.performance_target].some((v) => v !== null)
  ) {
    throw new ApiError(400, "invalid_asset", "Card fields require a card asset");
  }
  if (asset.kind === "check_card" && !asset.linked_asset_id) {
    throw new ApiError(400, "invalid_asset", "A check card requires a linked account");
  }
  if (asset.linked_asset_id !== null) {
    const linked = db
      .query<{ kind: string }, [string]>("SELECT kind FROM assets WHERE id=?")
      .get(asset.linked_asset_id);
    if (asset.linked_asset_id === asset.id || !linked || (linked.kind !== "bank" && linked.kind !== "savings")) {
      throw new ApiError(400, "invalid_asset", "A card must link to a bank or savings account");
    }
  }
  if (
    asset.kind !== "bank" &&
    asset.kind !== "savings" &&
    db.query("SELECT 1 FROM assets WHERE linked_asset_id=? LIMIT 1").get(asset.id)
  ) {
    throw new ApiError(400, "invalid_asset", "Linked cards require this asset to remain a bank or savings account");
  }
}

export function createAsset(db: Database, input: AssetInput): Asset {
  const now = nowKst();
  const asset: Asset = {
    ...input,
    id: Bun.randomUUIDv7(),
    opening_date: input.opening_date ?? null,
    linked_asset_id: input.linked_asset_id ?? null,
    settlement_day: input.settlement_day ?? null,
    payment_day: input.payment_day ?? null,
    performance_target: input.performance_target ?? null,
    external_ref: null,
    sort: input.sort ?? 0,
    created_at: now,
    updated_at: now,
  };
  validateAsset(db, asset);
  db.query(`INSERT INTO assets(id,name,kind,group_name,opening_balance,linked_asset_id,settlement_day,
    payment_day,performance_target,sort,hidden,created_at,updated_at,opening_date) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    asset.id,
    asset.name,
    asset.kind,
    asset.group_name,
    asset.opening_balance,
    asset.linked_asset_id,
    asset.settlement_day,
    asset.payment_day,
    asset.performance_target,
    asset.sort,
    Number(asset.hidden),
    now,
    now,
    asset.opening_date,
  );
  return asset;
}

export function patchAsset(db: Database, id: string, patch: AssetPatch): Asset {
  const asset = AssetSchema.parse({ ...requireAsset(db, id), ...patch, updated_at: nowKst() });
  validateAsset(db, asset);
  db.query(`UPDATE assets SET name=?,kind=?,group_name=?,opening_balance=?,linked_asset_id=?,settlement_day=?,
    payment_day=?,performance_target=?,sort=?,hidden=?,updated_at=?,opening_date=? WHERE id=?`).run(
    asset.name,
    asset.kind,
    asset.group_name,
    asset.opening_balance,
    asset.linked_asset_id,
    asset.settlement_day,
    asset.payment_day,
    asset.performance_target,
    asset.sort,
    Number(asset.hidden),
    asset.updated_at,
    asset.opening_date,
    id,
  );
  return asset;
}

export function deleteAsset(db: Database, id: string): void {
  requireAsset(db, id);
  if (
    db.query("SELECT 1 FROM transactions WHERE asset_id=? OR to_asset_id=? LIMIT 1").get(id, id) ||
    db.query("SELECT 1 FROM assets WHERE linked_asset_id=? LIMIT 1").get(id) ||
    db
      .query(
        "SELECT 1 FROM recurring_rules WHERE json_extract(template,'$.asset_id')=? OR json_extract(template,'$.to_asset_id')=? LIMIT 1",
      )
      .get(id, id) ||
    db
      .query(
        "SELECT 1 FROM templates WHERE json_extract(payload,'$.asset_id')=? OR json_extract(payload,'$.to_asset_id')=? LIMIT 1",
      )
      .get(id, id)
  ) {
    throw new ApiError(409, "in_use", "Asset is referenced; hide it instead");
  }
  db.query("DELETE FROM assets WHERE id=?").run(id);
}

function settlement(month: string, day: number): string {
  const year = Number(month.slice(0, 4));
  const number = Number(month.slice(5, 7));
  return `${month}-${String(Math.min(day, daysInMonth(year, number))).padStart(2, "0")}`;
}

/** Display ranges include both endpoints; settlement day belongs to the cycle ending that day. */
function cycleAt(today: string, day: number): Cycle {
  const month = today.slice(0, 7);
  const endMonth = today <= settlement(month, day) ? month : addMonths(month, 1);
  return { from: addDays(settlement(addMonths(endMonth, -1), day), 1), to: settlement(endMonth, day) };
}

function spend(flows: readonly Flow[], assetId: string, cycle: Cycle): number {
  return flows.reduce((sum, flow) => {
    const date = kstDate(flow.occurred_at);
    return flow.asset_id === assetId && flow.type === "expense" && date >= cycle.from && date <= cycle.to
      ? sum + (flow.is_refund ? -flow.amount : flow.amount)
      : sum;
  }, 0);
}

export function assetSummary(db: Database, today = kstDate(), includeHidden = false): AssetSummary {
  const assets = db
    .query("SELECT * FROM assets ORDER BY sort, created_at, id")
    .all()
    .map((row) => AssetRowSchema.parse(row));
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const flows = db
    .query<Flow, []>(
      "SELECT type,amount,is_refund,asset_id,to_asset_id,occurred_at FROM transactions WHERE deleted_at IS NULL AND hidden=0",
    )
    .all();
  // Balances are accumulated once on the account, never independently on its linked check cards.
  const balances = new Map(
    assets.map((asset) => [asset.id, asset.kind === "credit_card" ? -asset.opening_balance : asset.opening_balance]),
  );
  const apply = (id: string | null, delta: number, date: string) => {
    if (id === null) return;
    const asset = byId.get(id);
    const target = asset?.kind === "check_card" ? asset.linked_asset_id : id;
    if (target === null) return;
    const cutoff = byId.get(target)?.opening_date;
    if (cutoff != null && date < cutoff) return;
    balances.set(target, (balances.get(target) ?? 0) + delta);
  };
  for (const flow of flows) {
    const date = kstDate(flow.occurred_at);
    switch (flow.type) {
      case "income":
        apply(flow.asset_id, flow.amount, date);
        break;
      case "expense":
        apply(flow.asset_id, flow.is_refund ? flow.amount : -flow.amount, date);
        break;
      case "transfer":
        apply(flow.asset_id, -flow.amount, date);
        apply(flow.to_asset_id, flow.amount, date);
        break;
      default: {
        const unreachable: never = flow.type;
        throw new ApiError(500, "invalid_transaction", `Unknown transaction type: ${unreachable}`);
      }
    }
  }
  const rows = assets
    .filter((asset) => includeHidden || !asset.hidden)
    .map((asset) => {
      const isCard = asset.kind === "check_card" || asset.kind === "credit_card";
      const day = asset.settlement_day ?? 31;
      const cycle = isCard ? cycleAt(today, day) : null;
      const usage = cycle ? spend(flows, asset.id, cycle) : null;
      let expectedPayment: number | null = null;
      let paymentDate: string | null = null;
      if (asset.kind === "credit_card" && cycle) {
        const closed = cycleAt(addDays(cycle.from, -1), day);
        const payments = flows.reduce((sum, flow) => {
          const date = kstDate(flow.occurred_at);
          return flow.type === "transfer" && flow.to_asset_id === asset.id && date > closed.to && date <= today
            ? sum + flow.amount
            : sum;
        }, 0);
        expectedPayment = Math.max(0, spend(flows, asset.id, closed) - payments);
        if (asset.payment_day !== null) {
          const month = addMonths(cycle.to.slice(0, 7), asset.payment_day <= day ? 1 : 0);
          paymentDate = settlement(month, asset.payment_day);
        }
      }
      const balanceId = asset.kind === "check_card" ? asset.linked_asset_id : asset.id;
      const balance = balanceId === null ? 0 : (balances.get(balanceId) ?? 0);
      const report =
        asset.external_ref === null
          ? null
          : db
              .query<{ value: string }, [string]>("SELECT value FROM import_state WHERE key=?")
              .get(`reported:${asset.external_ref}`);
      const reported = report
        ? z.object({ balance: z.number().int(), at: z.string() }).parse(JSON.parse(report.value))
        : null;
      return {
        ...asset,
        balance,
        usage,
        cycle,
        payment_date: paymentDate,
        expected_payment: expectedPayment,
        performance:
          asset.performance_target !== null && usage !== null
            ? {
                target: asset.performance_target,
                achieved: usage,
                pct: asset.performance_target === 0 ? 0 : (usage / asset.performance_target) * 100,
              }
            : null,
        reported_balance: reported?.balance ?? null,
        reported_at: reported?.at ?? null,
        mismatch: reported ? balance - reported.balance : null,
      };
    });
  let totalAssets = 0;
  let debts = 0;
  for (const row of rows) {
    if (row.kind === "check_card") continue;
    totalAssets += Math.max(0, row.balance);
    debts += Math.max(0, -row.balance);
  }
  return { assets: rows, totals: { assets: totalAssets, debts, net_worth: totalAssets - debts } };
}

export function cardPayment(db: Database, id: string, input: CardPaymentInput) {
  return db
    .transaction(() => {
      const card = requireAsset(db, id);
      if (card.kind !== "credit_card" || card.linked_asset_id === null) {
        throw new ApiError(400, "invalid_card_payment", "Payment requires a credit card with a linked account");
      }
      const occurredAt = input.date ? `${input.date}T00:00:00+09:00` : nowKst();
      const row = assetSummary(db, kstDate(occurredAt), true).assets.find((asset) => asset.id === id);
      const amount = input.amount ?? row?.expected_payment ?? 0;
      if (amount <= 0) throw new ApiError(400, "invalid_card_payment", "There is no unpaid closed cycle");
      return insertTransaction(
        db,
        TransactionInputSchema.parse({
          type: "transfer",
          amount,
          occurred_at: occurredAt,
          asset_id: card.linked_asset_id,
          to_asset_id: card.id,
        }),
        { source: "card_payment" },
      );
    })
    .immediate();
}
