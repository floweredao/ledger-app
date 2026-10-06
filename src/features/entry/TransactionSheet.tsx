import { type MutableRefObject, useEffect, useId, useRef, useState } from "react";
import { merchantKey } from "../../../shared/merchant";
import { formatWon } from "../../../shared/money";
import type {
  Asset,
  Category,
  MerchantRule,
  SourceDetail,
  Template,
  Transaction,
  TransactionType,
} from "../../../shared/schema";
import { api, isApiError, isNetworkError } from "../../api/client";
import { invalidate } from "../../api/hooks";
import { Chip } from "../../components/Chip";
import { Field, Input } from "../../components/Field";
import { Badge } from "../../components/ListRow";
import { SegmentedControl } from "../../components/SegmentedControl";
import { toast } from "../../components/Toast";
import { AssetPicker } from "./AssetPicker";
import { CategoryPicker } from "./CategoryPicker";
import { DateTimeField } from "./DateTimeField";
import { FavoritesRow } from "./FavoritesRow";
import {
  applyTemplate,
  convertToTransfer,
  type EntryDraft,
  fromTransaction,
  hasErrors,
  type KeypadKey,
  pressKey,
  SOURCE_LABEL,
  switchType,
  TYPE_LABEL,
  templateFrom,
  toCreate,
  toPatch,
  transferTargets,
  validate,
} from "./form";
import { Keypad } from "./Keypad";
import { useEntryKeyboard } from "./useEntryKeyboard";
import "./entry.css";

export type EntryData = {
  readonly categories: readonly Category[];
  readonly assets: readonly Asset[];
  readonly templates: readonly Template[];
  readonly rules: readonly MerchantRule[];
  /** Newest first; feeds recent categories, last asset and merchant suggestions. */
  readonly recent: readonly Transaction[];
};

type Props = {
  readonly data: EntryData;
  readonly initial: EntryDraft;
  readonly original: Transaction | null;
  readonly controls: {
    readonly saveRef: MutableRefObject<(() => void) | null>;
    readonly onDirtyChange: (dirty: boolean) => void;
    readonly onSaved: () => void;
  };
};

const TYPE_OPTIONS = (["expense", "income", "transfer"] as const).map((value) => ({ value, label: TYPE_LABEL[value] }));
const LEDGER_PREFIXES = ["transactions", "stats", "budgets", "assets", "merchant-rules"] as const;

export function refreshLedger(): void {
  for (const prefix of LEDGER_PREFIXES) invalidate(prefix);
}

function saveErrorMessage(error: unknown): string {
  if (isNetworkError(error)) return "서버에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.";
  if (isApiError(error) && error.status === 400) return "저장하지 못했어요. 입력한 내용을 확인해 주세요.";
  return "저장하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

/** Read-only copy of what the bank import first recorded; it stays put however the title or memo is edited. */
function SourceDetailSection({ detail, labelId }: { readonly detail: SourceDetail; readonly labelId: string }) {
  const sign = detail.amount < 0 ? "-" : "+";
  const amount =
    detail.currency === null
      ? `${sign}${formatWon(Math.abs(detail.amount))}`
      : `${sign}${detail.currency} ${Math.abs(detail.amount).toLocaleString("ko-KR", { maximumFractionDigits: 4 })}`;
  const rows: readonly (readonly [string, string, boolean])[] = [
    ["거래처", detail.counterparty || "없음", false],
    ["종류", detail.kind || "없음", false],
    ["금액", amount, true],
    ["계좌", detail.account, true],
    ...(detail.balance === null ? [] : [["잔액", formatWon(detail.balance), true] as const]),
    ["받은 시각", detail.at.slice(0, 16).replace("T", " "), true],
  ];
  return (
    <section className="entry-section entry-source-detail" aria-labelledby={labelId}>
      <h3 className="entry-label" id={labelId}>
        자동 저장 원래 내용
      </h3>
      <dl className="entry-source-list">
        {rows.map(([label, value, numeric]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={numeric ? "num" : undefined}>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="entry-hint">내용이나 메모를 고쳐도 처음 자동으로 저장된 내용은 여기 그대로 남아요.</p>
    </section>
  );
}

export function TransactionSheet({ data, initial, original, controls }: Props) {
  const ids = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const busy = useRef(false);
  const [draft, setDraft] = useState(initial);
  const [attempted, setAttempted] = useState(false);
  const [categoryTouched, setCategoryTouched] = useState(original !== null);
  const [applyToPast, setApplyToPast] = useState(false);
  const [textFocus, setTextFocus] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const errors = attempted ? validate(draft, original?.amount) : {};
  const categoryOf = (id: string | null) => data.categories.find((c) => c.id === id);
  const merchants = [...new Set(data.recent.map((tx) => tx.merchant.trim()).filter(Boolean))].slice(0, 30);
  const recentCategoryIds = [...new Set(data.recent.flatMap((tx) => (tx.category_id ? [tx.category_id] : [])))];
  const originalCategory = original ? fromTransaction(original).categoryId : null;
  const offerApplyToPast =
    original !== null &&
    original.merchant_key !== "" &&
    draft.categoryId !== originalCategory &&
    draft.categoryId !== null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  const { onDirtyChange } = controls;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const key = (k: KeypadKey) => setDraft((d) => ({ ...d, amount: pressKey(d.amount, k) }));
  const setType = (type: TransactionType) => setDraft((d) => switchType(d, type, (id) => categoryOf(id)?.type));
  const pickCategory = (id: string) => {
    setCategoryTouched(true);
    setDraft((d) => ({ ...d, categoryId: id }));
  };
  const setMerchant = (merchant: string) => {
    const rule = data.rules.find((r) => r.merchant_key === merchantKey(merchant) && r.type === draft.type);
    const learned = !categoryTouched && draft.type !== "transfer" && rule ? rule.category_id : null;
    setDraft((d) => ({ ...d, merchant, ...(learned ? { categoryId: learned } : {}) }));
  };

  const save = async (next: EntryDraft = draft) => {
    setAttempted(true);
    if (busy.current || hasErrors(validate(next, original?.amount))) return;
    busy.current = true;
    setFormError(null);
    try {
      if (original) {
        const patch = toPatch(original, next, applyToPast);
        if (Object.keys(patch).length > 0) await api.patchTransaction(original.id, patch);
      } else {
        const result = await api.createTransaction(toCreate(next));
        if ("queued" in result) toast({ message: "연결되면 저장할게요" });
      }
      refreshLedger();
      controls.onSaved();
    } catch (error) {
      setFormError(saveErrorMessage(error));
    } finally {
      busy.current = false;
    }
  };
  controls.saveRef.current = () => void save();
  useEntryKeyboard(formRef, { onKey: key, onEnter: () => void save() });

  const amountErrorId = `${ids}-amount-error`;
  const textFocusProps = { onFocus: () => setTextFocus(true), onBlur: () => setTextFocus(false) };
  // Hidden categories (and the children of hidden parents) stay out of the picker, except the one this form
  // opened with, so editing a record saved on it neither loses nor silently changes its category.
  const opened = categoryOf(initial.categoryId);
  const kept = new Set([opened?.id, opened?.parent_id]);
  const hiddenIds = new Set(data.categories.filter((c) => c.hidden).map((c) => c.id));
  const typeCategories = data.categories.filter(
    (c) =>
      c.type === draft.type && (kept.has(c.id) || (!c.hidden && (c.parent_id === null || !hiddenIds.has(c.parent_id)))),
  );
  const conversionTargets = original && draft.type !== "transfer" ? transferTargets(data.assets, draft.assetId) : [];
  const convert = (targetId: string) => {
    const next = convertToTransfer(draft, targetId);
    setDraft(next);
    void save(next);
  };

  return (
    <form ref={formRef} className="entry-form" onSubmit={(e) => e.preventDefault()} noValidate>
      {(original && original.source !== "manual") || draft.isRefund ? (
        <p className="entry-badges">
          {original && original.source !== "manual" ? (
            <Badge tone="accent">{SOURCE_LABEL[original.source]}</Badge>
          ) : null}
          {draft.isRefund ? <Badge tone="accent">환불</Badge> : null}
        </p>
      ) : null}
      <SegmentedControl label="거래 종류" options={TYPE_OPTIONS} value={draft.type} onChange={setType} />
      <div className="entry-amount-block">
        <output
          className="entry-amount num"
          aria-label="금액"
          aria-describedby={errors.amount ? amountErrorId : undefined}
          aria-invalid={errors.amount ? true : undefined}
          data-empty={draft.amount === "" || undefined}
        >
          {formatWon(draft.amount === "" ? 0 : Number(draft.amount))}
        </output>
        {errors.amount ? (
          <p className="field-error entry-amount-error" id={amountErrorId} role="alert">
            {errors.amount}
          </p>
        ) : null}
      </div>
      <Keypad onKey={key} hidden={textFocus} />
      {draft.type === "transfer" ? null : (
        <CategoryPicker
          categories={typeCategories}
          recentIds={recentCategoryIds}
          value={draft.categoryId}
          onChange={pickCategory}
        />
      )}
      {offerApplyToPast ? (
        <label className="entry-toggle">
          <input type="checkbox" checked={applyToPast} onChange={(e) => setApplyToPast(e.target.checked)} />
          같은 가게 지난 거래에도 적용
        </label>
      ) : null}
      <AssetPicker
        label={draft.type === "transfer" ? "보내는 자산" : "자산"}
        assets={data.assets}
        value={draft.assetId}
        onChange={(assetId) => setDraft((d) => ({ ...d, assetId }))}
      />
      {draft.type === "transfer" ? (
        <AssetPicker
          label="받는 자산"
          assets={data.assets}
          value={draft.toAssetId}
          onChange={(toAssetId) => setDraft((d) => ({ ...d, toAssetId }))}
          error={errors.toAsset}
        />
      ) : null}
      {conversionTargets.length > 0 ? (
        <fieldset className="entry-section entry-fieldset" aria-describedby={`${ids}-convert-hint`}>
          <legend className="entry-label">이체로 바꾸기</legend>
          <p className="entry-hint" id={`${ids}-convert-hint`}>
            {draft.type === "income" || draft.isRefund
              ? "고른 자산에서 받은 돈으로 바로 저장해요. 통계에서는 빠져요."
              : "고른 자산으로 보낸 돈으로 바로 저장해요. 통계에서는 빠져요."}
          </p>
          <div className="chip-row">
            {conversionTargets.map((asset) => (
              <Chip key={asset.id} onClick={() => convert(asset.id)}>
                {asset.name}
              </Chip>
            ))}
          </div>
        </fieldset>
      ) : null}
      <DateTimeField
        date={draft.date}
        time={draft.time}
        onChange={(when) => setDraft((d) => ({ ...d, ...when }))}
        error={errors.when}
      />
      <Field label="내용">
        {(control) => (
          <Input
            {...control}
            {...textFocusProps}
            list={`${ids}-merchants`}
            maxLength={100}
            autoComplete="off"
            enterKeyHint="done"
            value={draft.merchant}
            onChange={(e) => setMerchant(e.target.value)}
          />
        )}
      </Field>
      <datalist id={`${ids}-merchants`}>
        {merchants.map((merchant) => (
          <option key={merchant} value={merchant} />
        ))}
      </datalist>
      <Field label="메모">
        {(control) => (
          <Input
            {...control}
            {...textFocusProps}
            maxLength={500}
            enterKeyHint="done"
            value={draft.memo}
            onChange={(e) => setDraft((d) => ({ ...d, memo: e.target.value }))}
          />
        )}
      </Field>
      {original?.source_detail ? (
        <SourceDetailSection detail={original.source_detail} labelId={`${ids}-source-detail`} />
      ) : null}
      {original ? null : (
        <FavoritesRow
          templates={data.templates}
          onPick={(payload) => setDraft((d) => applyTemplate(d, payload))}
          currentAsTemplate={() => templateFrom(draft, categoryOf(draft.categoryId)?.name)}
        />
      )}
      {formError ? (
        <p className="field-error" role="alert">
          {formError}
        </p>
      ) : null}
    </form>
  );
}
