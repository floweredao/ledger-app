import { toKstIso } from "../../../shared/dates";
import {
  MAX_AMOUNT,
  type Source,
  type TemplatePayload,
  type Transaction,
  type TransactionPatch,
  type TransactionType,
} from "../../../shared/schema";
import type { TransactionCreate } from "../../api/client";

export type KeypadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "00" | "backspace";

/** The editable form state; `amount` keeps the typed digits so the keypad never round-trips through a number. */
export type EntryDraft = {
  readonly type: TransactionType;
  readonly isRefund: boolean;
  readonly amount: string;
  readonly categoryId: string | null;
  readonly assetId: string | null;
  readonly toAssetId: string | null;
  /** `YYYY-MM-DD` KST */
  readonly date: string;
  /** `HH:MM` KST */
  readonly time: string;
  readonly merchant: string;
  readonly memo: string;
};

export type DraftErrors = { readonly amount?: string; readonly toAsset?: string; readonly when?: string };

export const TYPE_LABEL: Readonly<Record<TransactionType, string>> = {
  expense: "지출",
  income: "수입",
  transfer: "이체",
};

export const SOURCE_LABEL: Readonly<Record<Source, string>> = {
  manual: "직접 입력",
  kakaobank_excel: "카카오뱅크 엑셀",
  kakaobank_sms: "카카오뱅크 알림",
  recurring: "반복",
  import: "가져오기",
  card_payment: "카드 대금",
};

const KEYBOARD: Readonly<Record<string, KeypadKey>> = {
  "0": "0",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  Backspace: "backspace",
};

export const keypadKeyFor = (keyboardKey: string): KeypadKey | undefined => KEYBOARD[keyboardKey];

export function pressKey(amount: string, key: KeypadKey): string {
  if (key === "backspace") return amount.slice(0, -1);
  const next = `${amount}${key}`.replace(/^0+/, "");
  return Number(next) > MAX_AMOUNT ? amount : next;
}

export const amountOf = (draft: EntryDraft): number => (draft.amount === "" ? 0 : Number(draft.amount));

export function validate(draft: EntryDraft, originalAmount?: number): DraftErrors {
  const transferOk =
    draft.type !== "transfer" ||
    (draft.assetId !== null && draft.toAssetId !== null && draft.toAssetId !== draft.assetId);
  return {
    ...(amountOf(draft) > 0 || (originalAmount === 0 && amountOf(draft) === 0)
      ? {}
      : { amount: "금액을 입력해 주세요" }),
    ...(transferOk ? {} : { toAsset: "받는 자산을 보내는 자산과 다르게 골라 주세요" }),
    ...(draft.date && draft.time ? {} : { when: "날짜와 시간을 골라 주세요" }),
  };
}

export const hasErrors = (errors: DraftErrors): boolean => Object.keys(errors).length > 0;

export function splitOccurredAt(iso: string): { readonly date: string; readonly time: string } {
  const kst = toKstIso(new Date(iso));
  return { date: kst.slice(0, 10), time: kst.slice(11, 16) };
}

export function fromTransaction(tx: Transaction): EntryDraft {
  return {
    type: tx.type,
    isRefund: tx.is_refund,
    amount: String(tx.amount),
    categoryId: tx.category_id,
    assetId: tx.asset_id,
    toAssetId: tx.to_asset_id,
    ...splitOccurredAt(tx.occurred_at),
    merchant: tx.merchant,
    memo: tx.memo,
  };
}

const FIELD_KEYS = [
  "type",
  "is_refund",
  "amount",
  "occurred_at",
  "asset_id",
  "to_asset_id",
  "category_id",
  "merchant",
  "memo",
] as const;
type Fields = {
  type: TransactionType;
  is_refund: boolean;
  amount: number;
  occurred_at: string;
  asset_id: string | null;
  to_asset_id: string | null;
  category_id: string | null;
  merchant: string;
  memo: string;
};

function fieldsOf(draft: EntryDraft): Fields {
  const transfer = draft.type === "transfer";
  return {
    type: draft.type,
    is_refund: draft.type === "expense" && draft.isRefund,
    amount: amountOf(draft),
    occurred_at: `${draft.date}T${draft.time}:00+09:00`,
    asset_id: draft.assetId,
    to_asset_id: transfer ? draft.toAssetId : null,
    category_id: transfer ? null : draft.categoryId,
    merchant: draft.merchant.trim(),
    memo: draft.memo,
  };
}

export const toCreate = (draft: EntryDraft): TransactionCreate => fieldsOf(draft);

/** Only the fields that differ from the loaded row, so the server locks just what the owner changed. */
export function toPatch(original: Transaction, draft: EntryDraft, applyToPast: boolean): TransactionPatch {
  const before = fieldsOf(fromTransaction(original));
  const after = fieldsOf(draft);
  const patch: Partial<Fields> = {};
  const copy = <K extends keyof Fields>(key: K) => {
    if (after[key] !== before[key]) patch[key] = after[key];
  };
  for (const key of FIELD_KEYS) copy(key);
  const categoryChanged = patch.category_id !== undefined;
  return categoryChanged && applyToPast ? { ...patch, apply_to_past: true } : patch;
}

export function applyTemplate(draft: EntryDraft, payload: TemplatePayload): EntryDraft {
  return {
    ...draft,
    type: payload.type,
    isRefund: payload.type === "expense" && (payload.is_refund ?? false),
    amount: payload.amount === undefined ? draft.amount : String(payload.amount),
    categoryId: payload.category_id ?? null,
    assetId: payload.asset_id ?? draft.assetId,
    toAssetId: payload.to_asset_id ?? null,
    merchant: payload.merchant ?? "",
    memo: payload.memo ?? "",
  };
}

export function templateFrom(draft: EntryDraft, categoryName: string | undefined) {
  const fields = fieldsOf(draft);
  const name = (fields.merchant || categoryName || TYPE_LABEL[draft.type]).slice(0, 40);
  const payload: TemplatePayload = {
    type: fields.type,
    is_refund: fields.is_refund,
    ...(fields.amount > 0 ? { amount: fields.amount } : {}),
    asset_id: fields.asset_id,
    ...(fields.type === "transfer" ? { to_asset_id: fields.to_asset_id } : { category_id: fields.category_id }),
    merchant: fields.merchant,
    memo: fields.memo,
  };
  return { name, payload };
}

/** Switching type drops a category that belongs to the other type; transfers carry no category. */
export function switchType(
  draft: EntryDraft,
  type: TransactionType,
  categoryType: (id: string) => string | undefined,
): EntryDraft {
  const keep = type !== "transfer" && draft.categoryId !== null && categoryType(draft.categoryId) === type;
  return { ...draft, type, isRefund: type === "expense" && draft.isRefund, categoryId: keep ? draft.categoryId : null };
}
