import { toKstIso } from "../../../shared/dates";
import {
  type Asset,
  MAX_AMOUNT,
  type Source,
  type TemplatePayload,
  type Transaction,
  type TransactionPatch,
  type TransactionType,
} from "../../../shared/schema";
import type { TransactionCreate } from "../../api/client";
import { messages } from "../../i18n";
import { common } from "../../i18n/common";
import { entryMessages } from "./messages";

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
  get expense() {
    return messages(common).expense;
  },
  get income() {
    return messages(common).income;
  },
  get transfer() {
    return messages(common).transfer;
  },
};

export const SOURCE_LABEL: Readonly<Record<Source, string>> = {
  get manual() {
    return messages(entryMessages).sourceManual;
  },
  get kakaobank_excel() {
    return messages(entryMessages).sourceExcel;
  },
  get kakaobank_sms() {
    return messages(entryMessages).sourceNotification;
  },
  get recurring() {
    return messages(entryMessages).sourceRecurring;
  },
  get import() {
    return messages(entryMessages).sourceImport;
  },
  get card_payment() {
    return messages(entryMessages).sourceCardPayment;
  },
};

const KEYBOARD: Readonly<Record<string, CalcKey>> = {
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
  "+": "+",
  "-": "−",
  "*": "×",
  "/": "÷",
};

export const keypadKeyFor = (keyboardKey: string): CalcKey | undefined => KEYBOARD[keyboardKey];

export function pressKey(amount: string, key: KeypadKey): string {
  if (key === "backspace") return amount.slice(0, -1);
  const next = `${amount}${key}`.replace(/^0+/, "");
  return Number(next) > MAX_AMOUNT ? amount : next;
}

export type CalcOperator = "+" | "−" | "×" | "÷";
export type CalcKey = KeypadKey | CalcOperator | "clear";
const OPERATORS: readonly string[] = ["+", "−", "×", "÷"];
const isOperator = (char: string | undefined): char is CalcOperator => char !== undefined && OPERATORS.includes(char);

export const hasOperator = (expression: string): boolean => [...expression].some(isOperator);

/** Edits the keypad expression ("8000+3500"); an operator after an operator replaces it, numbers drop leading zeros. */
export function pressCalcKey(expression: string, key: CalcKey): string {
  if (key === "clear") return "";
  if (key === "backspace") return expression.slice(0, -1);
  if (isOperator(key)) {
    if (expression === "") return "";
    return isOperator(expression.at(-1)) ? `${expression.slice(0, -1)}${key}` : `${expression}${key}`;
  }
  const start = Math.max(...OPERATORS.map((op) => expression.lastIndexOf(op))) + 1;
  // The first number drops every leading zero (as the plain amount does); later ones keep a single 0 so ÷0 can be typed.
  const number = `${expression.slice(start)}${key}`.replace(start === 0 ? /^0+/ : /^0+(?=\d)/, "");
  if (Number(number) > MAX_AMOUNT) return expression;
  return `${expression.slice(0, start)}${number}`;
}

export type Evaluation =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly reason: "divide_by_zero" | "not_positive" | "too_large" };

/** × and ÷ before + and −, left to right; the result is rounded to whole won. A trailing operator is ignored. */
export function evaluateExpression(expression: string): Evaluation {
  const trimmed = isOperator(expression.at(-1)) ? expression.slice(0, -1) : expression;
  const tokens = trimmed.split(/([+−×÷])/).filter((token) => token !== "");
  const terms: number[] = [];
  let sign = 1;
  let term: number | null = null;
  let pending: CalcOperator | null = null;
  for (const token of tokens) {
    if (isOperator(token)) {
      if (token === "+" || token === "−") {
        if (term !== null) terms.push(sign * term);
        sign = token === "+" ? 1 : -1;
        term = null;
        pending = null;
      } else pending = token;
      continue;
    }
    const value = Number(token);
    if (term === null || pending === null) term = value;
    else if (pending === "×") term *= value;
    else {
      if (value === 0) return { ok: false, reason: "divide_by_zero" };
      term /= value;
    }
    pending = null;
  }
  if (term !== null) terms.push(sign * term);
  const result = Math.round(terms.reduce((sum, value) => sum + value, 0));
  if (result <= 0) return { ok: false, reason: "not_positive" };
  if (result > MAX_AMOUNT) return { ok: false, reason: "too_large" };
  return { ok: true, value: result };
}

export const amountOf = (draft: EntryDraft): number => (draft.amount === "" ? 0 : Number(draft.amount));

/** A balance adjustment is a transfer with one side empty; editing it keeps that side empty and the other filled. */
const keepsEmptySide = (draft: EntryDraft, original: Transaction | undefined): boolean =>
  original !== undefined &&
  original.type === "transfer" &&
  (original.asset_id === null) !== (original.to_asset_id === null) &&
  (draft.assetId === null) === (original.asset_id === null) &&
  (draft.toAssetId === null) === (original.to_asset_id === null);

export function validate(draft: EntryDraft, original?: Transaction): DraftErrors {
  const t = messages(entryMessages);
  const originalAmount = original?.amount;
  const transferOk =
    draft.type !== "transfer" ||
    (draft.assetId !== null && draft.toAssetId !== null && draft.toAssetId !== draft.assetId) ||
    keepsEmptySide(draft, original);
  return {
    ...(amountOf(draft) > 0 || (originalAmount === 0 && amountOf(draft) === 0) ? {} : { amount: t.amountRequired }),
    ...(transferOk ? {} : { toAsset: t.differentAssets }),
    ...(draft.date && draft.time ? {} : { when: t.dateTimeRequired }),
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

/** Assets an income or expense can be re-recorded as a transfer with: visible non-card assets other than its own account. */
export function transferTargets(assets: readonly Asset[], assetId: string | null): readonly Asset[] {
  const own = assets.find((asset) => asset.id === assetId);
  const ownAccount = own?.kind === "check_card" ? own.linked_asset_id : assetId;
  return assets.filter(
    (asset) =>
      !asset.hidden &&
      asset.kind !== "check_card" &&
      asset.kind !== "credit_card" &&
      asset.id !== assetId &&
      asset.id !== ownAccount,
  );
}

/** Money that left the asset goes to `targetId`; money that arrived (income, refund) came from it. */
export function convertToTransfer(draft: EntryDraft, targetId: string): EntryDraft {
  const arrived = draft.type === "income" || draft.isRefund;
  return {
    ...draft,
    type: "transfer",
    isRefund: false,
    categoryId: null,
    assetId: arrived ? targetId : draft.assetId,
    toAssetId: arrived ? draft.assetId : targetId,
  };
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
