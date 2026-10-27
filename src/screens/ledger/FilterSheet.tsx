import { useState } from "react";
import { addDays, kstDate, kstMonth } from "../../../shared/dates";
import type { Asset, Category, Source, TransactionType } from "../../../shared/schema";
import { Button } from "../../components/Button";
import { Chip } from "../../components/Chip";
import { Field, Input, Select } from "../../components/Field";
import { Sheet } from "../../components/Sheet";
import { useMessages } from "../../i18n";
import { common } from "../../i18n/common";
import { ledgerMessages } from "./messages";

// allow: SIZE_OK — This one scoped component contains every required accessible filter control.
export type HiddenFilter = "exclude" | "include" | "only";

export type SearchFilters = {
  readonly from: string;
  readonly to: string;
  readonly type: "" | TransactionType;
  readonly categoryIds: readonly string[];
  readonly assetId: string;
  readonly min: string;
  readonly max: string;
  readonly source: "" | Source;
  readonly hidden: HiddenFilter;
};

export const EMPTY_FILTERS: SearchFilters = {
  from: "",
  to: "",
  type: "",
  categoryIds: [],
  assetId: "",
  min: "",
  max: "",
  source: "",
  hidden: "exclude",
};

type FilterSheetProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly filters: SearchFilters;
  readonly onChange: (filters: SearchFilters) => void;
  readonly onApply: (filters: SearchFilters) => void;
  readonly error: string;
  readonly categories: readonly Category[];
  readonly assets: readonly Asset[];
};

function FilterInput({
  label,
  type,
  value,
  min,
  onChange,
}: {
  readonly label: string;
  readonly type: "date" | "number";
  readonly value: string;
  readonly min?: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      {(control) => (
        <Input
          {...control}
          type={type}
          {...(min ? { min } : {})}
          inputMode={type === "number" ? "numeric" : undefined}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      )}
    </Field>
  );
}

function rangeForPreset(preset: "today" | "this-month" | "last-month") {
  const today = kstDate();
  const firstOfThisMonth = `${kstMonth()}-01`;
  if (preset === "today") return { from: today, to: today };
  if (preset === "this-month") return { from: firstOfThisMonth, to: today };
  const previous = addDays(firstOfThisMonth, -1);
  return { from: `${kstMonth(previous)}-01`, to: previous };
}

export default function FilterSheet({
  open,
  onClose,
  filters,
  onChange,
  onApply,
  error,
  categories,
  assets,
}: FilterSheetProps) {
  const m = useMessages(ledgerMessages);
  const c = useMessages(common);
  const DATE_PRESETS = [
    ["today", m.today],
    ["this-month", m.thisMonth],
    ["last-month", m.lastMonth],
  ] as const;
  const TYPE_OPTIONS = [
    ["", m.all],
    ["expense", c.expense],
    ["income", c.income],
    ["transfer", c.transfer],
  ] as const;
  const HIDDEN_OPTIONS = [
    ["exclude", m.exclude],
    ["include", m.include],
    ["only", m.hiddenOnly],
  ] as const;
  const SOURCE_OPTIONS: readonly { readonly value: Source; readonly label: string }[] = [
    { value: "manual", label: m.manual },
    { value: "kakaobank_excel", label: m.bankFile },
    { value: "kakaobank_sms", label: m.bankText },
    { value: "recurring", label: m.recurring },
    { value: "import", label: m.imported },
    { value: "card_payment", label: m.cardPayment },
  ];

  const [datePreset, setDatePreset] = useState("");
  const update = (patch: Partial<SearchFilters>) => onChange({ ...filters, ...patch });
  const toggleCategory = (id: string) => {
    update({
      categoryIds: filters.categoryIds.includes(id) ? [] : [id],
    });
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={m.filters}
      footer={
        <div className="filter-actions">
          <Button variant="secondary" onClick={() => onChange(EMPTY_FILTERS)}>
            {m.reset}
          </Button>
          <Button variant="primary" onClick={() => onApply(filters)}>
            {m.apply}
          </Button>
        </div>
      }
    >
      <div className="filter-form">
        <fieldset className="filter-group">
          <legend className="filter-label">{m.period}</legend>
          <div className="filter-chip-row">
            {DATE_PRESETS.map(([value, label]) => (
              <Chip
                key={value}
                selected={datePreset === value}
                onClick={() => {
                  const range = rangeForPreset(value);
                  setDatePreset(value);
                  update(range);
                }}
              >
                {label}
              </Chip>
            ))}
          </div>
          <div className="filter-date-fields">
            {(["from", "to"] as const).map((name) => (
              <FilterInput
                key={name}
                label={name === "from" ? m.startDate : m.endDate}
                type="date"
                value={filters[name]}
                onChange={(value) => {
                  setDatePreset("");
                  update(name === "from" ? { from: value } : { to: value });
                }}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="filter-group">
          <legend className="filter-label">{m.transactionType}</legend>
          <div className="filter-chip-row">
            {TYPE_OPTIONS.map(([value, label]) => (
              <Chip key={value || "all"} selected={filters.type === value} onClick={() => update({ type: value })}>
                {label}
              </Chip>
            ))}
          </div>
        </fieldset>

        <fieldset className="filter-group">
          <legend className="filter-label">{m.category}</legend>
          <label className="filter-option">
            <input
              type="checkbox"
              checked={filters.categoryIds.includes("uncategorized")}
              onChange={() => toggleCategory("uncategorized")}
            />
            <span>{c.uncategorized}</span>
          </label>
          {categories.length ? (
            <div className="filter-option-list">
              {categories.map((category) => (
                <label className="filter-option" key={category.id}>
                  <input
                    type="checkbox"
                    checked={filters.categoryIds.includes(category.id)}
                    onChange={() => toggleCategory(category.id)}
                  />
                  <span>{category.name}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="filter-hint">{m.emptyCategories}</p>
          )}
        </fieldset>

        <Field label={m.asset}>
          {(control) => (
            <Select
              {...control}
              value={filters.assetId}
              onChange={(event) => update({ assetId: event.currentTarget.value })}
            >
              <option value="">{m.allAssets}</option>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <fieldset className="filter-group">
          <legend className="filter-label">{m.amount}</legend>
          <div className="filter-amount-fields">
            {(["min", "max"] as const).map((name) => (
              <FilterInput
                key={name}
                label={name === "min" ? m.minAmount : m.maxAmount}
                type="number"
                min="0"
                value={filters[name]}
                onChange={(value) => update(name === "min" ? { min: value } : { max: value })}
              />
            ))}
          </div>
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
        </fieldset>

        <Field label={m.entryMethod}>
          {(control) => (
            <Select
              {...control}
              value={filters.source}
              onChange={(event) =>
                update({
                  source: SOURCE_OPTIONS.find((source) => source.value === event.currentTarget.value)?.value ?? "",
                })
              }
            >
              <option value="">{m.allEntryMethods}</option>
              {SOURCE_OPTIONS.map((source) => (
                <option key={source.value} value={source.value}>
                  {source.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <p className="filter-hint">{m.entryMethodHint}</p>

        <fieldset className="filter-group">
          <legend className="filter-label">{m.hiddenRecords}</legend>
          <div className="filter-chip-row">
            {HIDDEN_OPTIONS.map(([value, label]) => (
              <Chip key={value} selected={filters.hidden === value} onClick={() => update({ hidden: value })}>
                {label}
              </Chip>
            ))}
          </div>
        </fieldset>
      </div>
    </Sheet>
  );
}
