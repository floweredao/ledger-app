import { Copy, Star, Trash2, X } from "lucide-react";
import { type MutableRefObject, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { merchantKey } from "../../../shared/merchant";
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
import { Button, IconButton } from "../../components/Button";
import { CategoryIcon } from "../../components/CategoryIcon";
import { Chip } from "../../components/Chip";
import { Badge } from "../../components/ListRow";
import { toast } from "../../components/Toast";
import { messages, useMessages } from "../../i18n";
import { common } from "../../i18n/common";
import { formatNumber, formatWon } from "../../i18n/format";
import { AssetPicker } from "./AssetPicker";
import { CategoryPicker } from "./CategoryPicker";
import {
  amountOf,
  applyTemplate,
  type CalcKey,
  convertToTransfer,
  type EntryDraft,
  type Evaluation,
  evaluateExpression,
  fromTransaction,
  hasErrors,
  hasOperator,
  pressCalcKey,
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
import { entryMessages } from "./messages";
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

export type SaveMode = "close" | "continue";

type Props = {
  readonly data: EntryData;
  readonly initial: EntryDraft;
  readonly original: Transaction | null;
  readonly controls: {
    readonly saveRef: MutableRefObject<((mode: SaveMode) => void) | null>;
    readonly onDirtyChange: (dirty: boolean) => void;
    readonly onSavingChange: (saving: boolean) => void;
    readonly onSaved: (mode: SaveMode) => void;
    /** Edit only: delete the loaded record (EntryHost owns undo). */
    readonly onDelete?: () => void;
    /** Edit only: start a new record from this one, dated now. */
    readonly onCopy?: (draft: EntryDraft) => void;
  };
};

type Panel = "amount" | "category" | "asset" | "toAsset" | "favorites";

const LEDGER_PREFIXES = ["transactions", "stats", "budgets", "assets", "merchant-rules"] as const;

export function refreshLedger(): void {
  for (const prefix of LEDGER_PREFIXES) invalidate(prefix);
}

function saveErrorMessage(error: unknown): string {
  const t = messages(entryMessages);
  if (isNetworkError(error)) return t.networkSaveFailed;
  if (isApiError(error) && error.status === 400) return t.invalidSave;
  return t.saveFailed;
}

/** Read-only copy of what the bank import first recorded; it stays put however the title or memo is edited. */
function SourceDetailSection({ detail, labelId }: { readonly detail: SourceDetail; readonly labelId: string }) {
  const t = useMessages(entryMessages);
  const c = useMessages(common);
  const sign = detail.amount < 0 ? "-" : "+";
  const amount =
    detail.currency === null
      ? `${sign}${formatWon(Math.abs(detail.amount))}`
      : `${sign}${detail.currency} ${formatNumber(Math.abs(detail.amount), { maximumFractionDigits: 4 })}`;
  const rows: readonly (readonly [string, string, boolean])[] = [
    [t.counterparty, detail.counterparty || c.none, false],
    [t.kind, detail.kind || c.none, false],
    [t.amount, amount, true],
    [t.account, detail.account, true],
    ...(detail.balance === null ? [] : [[t.balance, formatWon(detail.balance), true] as const]),
    [t.receivedAt, detail.at.slice(0, 16).replace("T", " "), true],
  ];
  return (
    <section className="entry-section entry-source-detail" aria-labelledby={labelId}>
      <h3 className="entry-label" id={labelId}>
        {t.originalDetails}
      </h3>
      <dl className="entry-source-list">
        {rows.map(([label, value, numeric]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={numeric ? "num" : undefined}>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="entry-hint">{t.originalHint}</p>
    </section>
  );
}

/** Thousands separators inside a keypad expression, with spaced operators: "8000+3500" -> "8,000 + 3,500". */
function formatExpression(expression: string): string {
  return expression
    .split(/([+−×÷])/)
    .map((token) => (/^\d+$/.test(token) ? formatNumber(Number(token)) : token ? ` ${token} ` : ""))
    .join("")
    .trim();
}

function calcError(result: Evaluation): string | null {
  const t = messages(entryMessages);
  if (result.ok) return null;
  if (result.reason === "divide_by_zero") return t.divideByZero;
  if (result.reason === "too_large") return t.amountTooLarge;
  return t.amountNotPositive;
}

function Row({
  label,
  labelFor,
  active,
  children,
}: {
  readonly label: string;
  readonly labelFor?: string;
  readonly active?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div className="entry-row" data-active={active || undefined}>
      {labelFor ? (
        <label className="entry-row-label" htmlFor={labelFor}>
          {label}
        </label>
      ) : (
        <span className="entry-row-label" aria-hidden="true">
          {label}
        </span>
      )}
      <div className="entry-row-control">{children}</div>
    </div>
  );
}

export function TransactionSheet({ data, initial, original, controls }: Props) {
  const t = useMessages(entryMessages);
  const c = useMessages(common);
  const TYPE_OPTIONS = (["income", "expense", "transfer"] as const).map((value) => ({
    value,
    label: TYPE_LABEL[value],
  }));
  const ids = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const merchantRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const isNew = original === null;
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [expression, setExpression] = useState(initial.amount);
  const [panel, setPanel] = useState<Panel | null>(isNew && initial.amount === "" ? "amount" : null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [categoryTouched, setCategoryTouched] = useState(!isNew);
  const [applyToPast, setApplyToPast] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const errors = attempted ? validate(draft, original ?? undefined) : {};
  const categoryOf = (id: string | null) => data.categories.find((c) => c.id === id);
  const assetName = (id: string | null) => data.assets.find((asset) => asset.id === id)?.name;
  const merchants = [...new Set(data.recent.map((tx) => tx.merchant.trim()).filter(Boolean))].slice(0, 30);
  const recentCategoryIds = [...new Set(data.recent.flatMap((tx) => (tx.category_id ? [tx.category_id] : [])))];
  const originalCategory = original ? fromTransaction(original).categoryId : null;
  const offerApplyToPast =
    original !== null &&
    original.merchant_key !== "" &&
    draft.categoryId !== originalCategory &&
    draft.categoryId !== null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline) || expression !== draft.amount;

  const { onDirtyChange } = controls;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  /** Applies a pending expression to the draft; returns the draft to save, or null when the expression is invalid. */
  const settleAmount = (): EntryDraft | null => {
    if (!hasOperator(expression)) return draft;
    const result = evaluateExpression(expression);
    const error = calcError(result);
    if (!result.ok) {
      setAmountError(error);
      setPanel("amount");
      return null;
    }
    const next = { ...draft, amount: String(result.value) };
    setExpression(next.amount);
    setDraft(next);
    return next;
  };

  const key = (k: CalcKey) => {
    setAmountError(null);
    const next = pressCalcKey(expression, k);
    setExpression(next);
    if (!hasOperator(next)) setDraft((d) => ({ ...d, amount: next }));
  };
  const advanceFrom = (step: Panel) => {
    if (!isNew) return setPanel(null);
    if (step === "amount") return setPanel(draft.type === "transfer" ? "asset" : "category");
    if (step === "category") return setPanel("asset");
    if (step === "asset" && draft.type === "transfer") return setPanel("toAsset");
    setPanel(null);
    merchantRef.current?.focus();
  };
  const equals = () => {
    settleAmount();
  };
  const confirmAmount = () => {
    const next = settleAmount();
    if (!next) return;
    if (amountOf(next) <= 0) {
      setAmountError(t.amountRequired);
      return;
    }
    advanceFrom("amount");
  };
  const setType = (type: TransactionType) => setDraft((d) => switchType(d, type, (id) => categoryOf(id)?.type));
  const pickCategory = (id: string, final: boolean) => {
    setCategoryTouched(true);
    setDraft((d) => ({ ...d, categoryId: id }));
    if (final) advanceFrom("category");
  };
  const pickAsset = (assetId: string) => {
    setDraft((d) => ({ ...d, assetId }));
    advanceFrom("asset");
  };
  const pickToAsset = (toAssetId: string) => {
    setDraft((d) => ({ ...d, toAssetId }));
    advanceFrom("toAsset");
  };
  const setMerchant = (merchant: string) => {
    const rule = data.rules.find((r) => r.merchant_key === merchantKey(merchant) && r.type === draft.type);
    const learned = !categoryTouched && draft.type !== "transfer" && rule ? rule.category_id : null;
    setDraft((d) => ({ ...d, merchant, ...(learned ? { categoryId: learned } : {}) }));
  };

  const startNext = (saved: EntryDraft) => {
    const next: EntryDraft = { ...saved, amount: "", categoryId: null, isRefund: false, merchant: "", memo: "" };
    setBaseline(next);
    setDraft(next);
    setExpression("");
    setAttempted(false);
    setCategoryTouched(false);
    setPanel("amount");
    setSavedCount((n) => n + 1);
    amountRef.current?.focus();
  };

  const save = async (mode: SaveMode, pending: EntryDraft | null = null) => {
    setAttempted(true);
    const next = pending ?? settleAmount();
    if (!next || busy.current || hasErrors(validate(next, original ?? undefined))) return;
    busy.current = true;
    controls.onSavingChange(true);
    setFormError(null);
    try {
      if (original) {
        const patch = toPatch(original, next, applyToPast);
        if (Object.keys(patch).length > 0) await api.patchTransaction(original.id, patch);
      } else {
        const result = await api.createTransaction(toCreate(next));
        if ("queued" in result) toast({ message: t.queued });
      }
      refreshLedger();
      if (mode === "continue") startNext(next);
      controls.onSaved(mode);
    } catch (error) {
      setFormError(saveErrorMessage(error));
    } finally {
      busy.current = false;
      controls.onSavingChange(false);
    }
  };
  controls.saveRef.current = (mode) => void save(mode);
  useEntryKeyboard(formRef, { onKey: key, onEnter: () => void save("close") });

  const saveFavorite = async () => {
    try {
      await api.createTemplate(templateFrom(draft, categoryOf(draft.categoryId)?.name));
      invalidate("templates");
      toast({ message: t.favoriteSaved });
    } catch (error) {
      console.warn("template save failed", error);
      toast({ message: t.favoriteFailed, tone: "error" });
    }
  };
  const pickFavorite = (template: Template) => {
    const next = applyTemplate(draft, template.payload);
    setDraft(next);
    setExpression(next.amount);
    setAmountError(null);
    setPanel(null);
  };

  const amountErrorId = `${ids}-amount-error`;
  const amountText =
    expression === "" ? "" : hasOperator(expression) ? formatExpression(expression) : formatWon(Number(expression));
  const shownAmountError = amountError ?? errors.amount;
  // Hidden categories (and the children of hidden parents) stay out of the picker, except the one this form
  // opened with, so editing a record saved on it neither loses nor silently changes its category.
  const opened = categoryOf(initial.categoryId);
  const kept = new Set([opened?.id, opened?.parent_id]);
  const hiddenIds = new Set(data.categories.filter((c) => c.hidden).map((c) => c.id));
  const typeCategories = data.categories.filter(
    (c) =>
      c.type === draft.type && (kept.has(c.id) || (!c.hidden && (c.parent_id === null || !hiddenIds.has(c.parent_id)))),
  );
  const category = categoryOf(draft.categoryId);
  const parent = category?.parent_id ? categoryOf(category.parent_id) : undefined;
  const categoryText = category ? (parent ? `${parent.name} › ${category.name}` : category.name) : "";
  const conversionTargets = original && draft.type !== "transfer" ? transferTargets(data.assets, draft.assetId) : [];
  const convert = (targetId: string) => {
    const next = convertToTransfer(draft, targetId);
    setDraft(next);
    void save("close", next);
  };
  const toggle = (next: Panel) => setPanel((current) => (current === next ? null : next));
  const panelTitle: Record<Panel, string> = {
    amount: t.amount,
    category: t.category,
    asset: draft.type === "transfer" ? t.fromAsset : t.asset,
    toAsset: t.toAsset,
    favorites: t.favoritesTitle,
  };
  const valueButton = (target: Panel, label: string, text: string, value: ReactNode = text, describedBy?: string) => (
    <button
      type="button"
      className="entry-value"
      aria-expanded={panel === target}
      aria-label={text ? `${label}, ${text}` : label}
      aria-describedby={describedBy}
      onClick={() => toggle(target)}
    >
      {value || <span className="entry-placeholder">{t.choose}</span>}
    </button>
  );

  return (
    <form ref={formRef} className="entry-form" onSubmit={(e) => e.preventDefault()} noValidate>
      {(original && original.source !== "manual") || draft.isRefund ? (
        <p className="entry-badges">
          {original && original.source !== "manual" ? (
            <Badge tone="accent">{SOURCE_LABEL[original.source]}</Badge>
          ) : null}
          {draft.isRefund ? <Badge tone="accent">{c.refund}</Badge> : null}
        </p>
      ) : null}
      <fieldset className="entry-types entry-fieldset">
        <legend className="sr-only">{t.transactionType}</legend>
        {TYPE_OPTIONS.map((option) => (
          <label key={option.value} className="entry-type" data-selected={option.value === draft.type || undefined}>
            <input
              className="sr-only"
              type="radio"
              name={`${ids}-type`}
              value={option.value}
              checked={option.value === draft.type}
              onChange={() => setType(option.value)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      <p className="entry-saved" role="status">
        {savedCount > 0 ? t.savedCount(savedCount) : ""}
      </p>
      <div className="entry-rows">
        <Row label={t.date} labelFor={`${ids}-date`}>
          <div className="entry-datetime">
            <input
              id={`${ids}-date`}
              className="input"
              type="date"
              value={draft.date}
              aria-invalid={errors.when ? true : undefined}
              onFocus={() => setPanel(null)}
              onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
            />
            <input
              className="input"
              type="time"
              aria-label={t.time}
              value={draft.time}
              aria-invalid={errors.when ? true : undefined}
              onFocus={() => setPanel(null)}
              onChange={(e) => setDraft((d) => ({ ...d, time: e.target.value }))}
            />
          </div>
          {errors.when ? <p className="field-error">{errors.when}</p> : null}
        </Row>
        <Row label={t.amount} active={panel === "amount"}>
          <button
            ref={amountRef}
            data-autofocus={isNew || undefined}
            type="button"
            className="entry-value entry-amount num"
            aria-expanded={panel === "amount"}
            aria-label={`${t.amount}, ${amountText || formatWon(0)}`}
            aria-describedby={shownAmountError ? amountErrorId : undefined}
            aria-invalid={shownAmountError ? true : undefined}
            onClick={() => setPanel("amount")}
          >
            {amountText || <span className="entry-placeholder">{t.enterAmount}</span>}
          </button>
          {shownAmountError ? (
            <p className="field-error" id={amountErrorId} role="alert">
              {shownAmountError}
            </p>
          ) : null}
        </Row>
        {draft.type === "transfer" ? null : (
          <Row label={t.category} active={panel === "category"}>
            {valueButton(
              "category",
              t.category,
              categoryText,
              category ? (
                <span className="entry-category-value">
                  <CategoryIcon
                    size="sm"
                    icon={category.icon ?? parent?.icon}
                    color={category.color ?? parent?.color}
                  />
                  {categoryText}
                </span>
              ) : (
                ""
              ),
            )}
          </Row>
        )}
        <Row label={draft.type === "transfer" ? t.fromAsset : t.asset} active={panel === "asset"}>
          {valueButton("asset", draft.type === "transfer" ? t.fromAsset : t.asset, assetName(draft.assetId) ?? "")}
        </Row>
        {draft.type === "transfer" ? (
          <Row label={t.toAsset} active={panel === "toAsset"}>
            {valueButton(
              "toAsset",
              t.toAsset,
              assetName(draft.toAssetId) ?? "",
              undefined,
              errors.toAsset ? `${ids}-to-error` : undefined,
            )}
            {errors.toAsset ? (
              <p className="field-error" id={`${ids}-to-error`}>
                {errors.toAsset}
              </p>
            ) : null}
          </Row>
        ) : null}
        <Row label={t.description} labelFor={`${ids}-merchant`}>
          <input
            ref={merchantRef}
            id={`${ids}-merchant`}
            className="input"
            list={`${ids}-merchants`}
            maxLength={100}
            autoComplete="off"
            enterKeyHint="done"
            value={draft.merchant}
            onFocus={() => setPanel(null)}
            onChange={(e) => setMerchant(e.target.value)}
          />
        </Row>
        <datalist id={`${ids}-merchants`}>
          {merchants.map((merchant) => (
            <option key={merchant} value={merchant} />
          ))}
        </datalist>
        <Row label={t.memo} labelFor={`${ids}-memo`}>
          <input
            id={`${ids}-memo`}
            className="input"
            maxLength={500}
            enterKeyHint="done"
            value={draft.memo}
            onFocus={() => setPanel(null)}
            onChange={(e) => setDraft((d) => ({ ...d, memo: e.target.value }))}
          />
        </Row>
      </div>
      {offerApplyToPast ? (
        <label className="entry-toggle">
          <input type="checkbox" checked={applyToPast} onChange={(e) => setApplyToPast(e.target.checked)} />
          {t.applyToPast}
        </label>
      ) : null}
      {conversionTargets.length > 0 ? (
        <fieldset className="entry-section entry-fieldset" aria-describedby={`${ids}-convert-hint`}>
          <legend className="entry-label">{t.convertTransfer}</legend>
          <p className="entry-hint" id={`${ids}-convert-hint`}>
            {draft.type === "income" || draft.isRefund ? t.incomingTransferHint : t.outgoingTransferHint}
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
      {original ? (
        <div className="entry-actions">
          {controls.onDelete ? (
            <Button variant="danger" icon={Trash2} onClick={controls.onDelete}>
              {c.delete}
            </Button>
          ) : null}
          {controls.onCopy ? (
            <Button icon={Copy} onClick={() => controls.onCopy?.(draft)}>
              {t.copyRecord}
            </Button>
          ) : null}
          <Button icon={Star} onClick={() => void saveFavorite()}>
            {t.favoritesTitle}
          </Button>
        </div>
      ) : null}
      {original?.source_detail ? (
        <SourceDetailSection detail={original.source_detail} labelId={`${ids}-source-detail`} />
      ) : null}
      {formError ? (
        <p className="field-error" role="alert">
          {formError}
        </p>
      ) : null}
      {isNew ? (
        <button
          type="button"
          className="entry-favorites-toggle"
          aria-expanded={panel === "favorites"}
          onClick={() => toggle("favorites")}
        >
          <Star aria-hidden="true" size={18} strokeWidth={2} />
          {t.favoritesTitle}
        </button>
      ) : null}
      {panel ? (
        <section className="entry-panel" aria-label={panelTitle[panel]}>
          <header className="entry-panel-header">
            <h3>{panelTitle[panel]}</h3>
            <IconButton label={t.closePanel(panelTitle[panel])} icon={X} onClick={() => setPanel(null)} />
          </header>
          {panel === "amount" ? <Keypad onKey={key} onEquals={equals} onConfirm={confirmAmount} /> : null}
          {panel === "category" ? (
            <CategoryPicker
              categories={typeCategories}
              recentIds={recentCategoryIds}
              value={draft.categoryId}
              onChange={pickCategory}
            />
          ) : null}
          {panel === "asset" ? (
            <AssetPicker
              label={draft.type === "transfer" ? t.fromAsset : t.asset}
              assets={data.assets}
              value={draft.assetId}
              onChange={pickAsset}
            />
          ) : null}
          {panel === "toAsset" ? (
            <AssetPicker label={t.toAsset} assets={data.assets} value={draft.toAssetId} onChange={pickToAsset} />
          ) : null}
          {panel === "favorites" ? (
            <div className="entry-picker">
              {data.templates.length === 0 ? <p className="entry-hint">{t.noFavorites}</p> : null}
              <div className="picker-grid">
                {data.templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className="picker-tile"
                    onClick={() => pickFavorite(template)}
                  >
                    <span className="picker-tile-name">{template.name}</span>
                  </button>
                ))}
              </div>
              <Button size="sm" variant="ghost" onClick={() => void saveFavorite()}>
                {t.saveFavorite}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
    </form>
  );
}
