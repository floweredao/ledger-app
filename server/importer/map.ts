import type { Database } from "bun:sqlite";
import { nowKst } from "../../shared/dates";
import { merchantKey } from "../../shared/merchant";
import { type TransactionInput, TransactionInputSchema } from "../../shared/schema";
import type { InsertOptions } from "../domain/tx-core";
import { classify, refundCategory } from "./classify";
import { type Entry, sourceKey } from "./source";

function asset(
  db: Database,
  externalRef: string,
  name: string,
  kind: string,
  opening: number,
  linked: string | null,
): string {
  const existing = db.query<{ id: string }, [string]>("SELECT id FROM assets WHERE external_ref=?").get(externalRef);
  if (existing) return existing.id;
  const id = Bun.randomUUIDv7();
  const now = nowKst();
  db.query(
    "INSERT INTO assets(id,name,kind,external_ref,opening_balance,linked_asset_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
  ).run(id, name, kind, externalRef, opening, linked, now, now);
  return id;
}

export type MappedEntry = {
  readonly input: TransactionInput;
  readonly options: InsertOptions;
};

export function mapEntry(db: Database, entry: Entry, previousBalance: number | null): MappedEntry {
  const refund = /취소|환불/.test(`${entry.kind} ${entry.counterparty}`);
  let amount = Math.abs(entry.amount);
  let currency = "KRW";
  let foreignAmount: number | null = null;
  let krwStatus: "exact" | "inferred" | "pending" = "exact";
  // AM-15: zero precedes currency, and currency precedes sign/refund interpretation.
  if (entry.amount !== 0 && entry.currency) {
    currency = entry.currency;
    foreignAmount = Math.abs(entry.amount);
    const delta =
      previousBalance !== null && entry.balance !== null
        ? entry.amount < 0
          ? previousBalance - entry.balance
          : entry.balance - previousBalance
        : 0;
    const rate = delta / foreignAmount;
    amount = rate >= 900 && rate <= 2500 ? delta : 0;
    krwStatus = amount > 0 ? "inferred" : "pending";
  }
  const signedAmount = entry.amount < 0 ? -amount : amount;
  const bank = asset(
    db,
    `kakaobank:${entry.account}`,
    `카카오뱅크 입출금 (${entry.account})`,
    "bank",
    (entry.balance ?? 0) - signedAmount,
    null,
  );
  const card = /카드|해외결제/.test(entry.kind);
  const paymentAsset = card
    ? asset(db, `kakaobank-checkcard:${entry.account}`, "카카오뱅크 체크카드", "check_card", 0, bank)
    : bank;
  const merchant = entry.counterparty.replace(/\([^()]*$/, "").trim();
  const ownerSetting = db.query<{ value: string }, []>("SELECT value FROM settings WHERE key='owner_name'").get();
  const owner: string = ownerSetting ? JSON.parse(ownerSetting.value) : "";
  const ownTransfer =
    merchantKey(owner) !== "" &&
    merchantKey(entry.counterparty).includes(merchantKey(owner)) &&
    /이체|입금/.test(entry.kind);
  let type: TransactionInput["type"] = refund || entry.amount <= 0 ? "expense" : "income";
  let assetId = paymentAsset;
  let toAssetId: string | null = null;
  if (ownTransfer) {
    const other = asset(db, "self:other", "내 다른 계좌", "other", 0, null);
    type = "transfer";
    assetId = entry.amount < 0 ? bank : other;
    toAssetId = entry.amount < 0 ? other : bank;
  }
  const original = refund ? refundCategory(db, entry) : null;
  const input = TransactionInputSchema.parse({
    type,
    occurred_at: entry.at,
    amount,
    is_refund: refund && type === "expense",
    currency,
    foreign_amount: foreignAmount,
    krw_status: krwStatus,
    asset_id: assetId,
    to_asset_id: toAssetId,
    category_id: original ? original.category_id : classify(db, entry, type, merchant),
    merchant,
    memo: "",
  });
  return {
    input,
    options: {
      source: entry.source === "excel" ? "kakaobank_excel" : "kakaobank_sms",
      source_key: sourceKey(entry),
      source_raw: JSON.stringify(entry),
      src_account: entry.account,
      src_amount: entry.amount,
      src_at: entry.at,
      hidden: entry.amount === 0,
      hidden_reason: entry.amount === 0 ? (/실패|거절/.test(entry.kind) ? "card_failed" : "zero_amount") : null,
    },
  };
}
