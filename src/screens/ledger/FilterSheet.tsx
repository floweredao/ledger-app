import { useState } from "react";
import { addDays, kstDate, kstMonth } from "../../../shared/dates";
import type { Asset, Category, Source, TransactionType } from "../../../shared/schema";
import { Button } from "../../components/Button";
import { Chip } from "../../components/Chip";
import { Field, Input, Select } from "../../components/Field";
import { Sheet } from "../../components/Sheet";

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

const DATE_PRESETS = [
  ["today", "오늘"],
  ["this-month", "이번 달"],
  ["last-month", "지난 달"],
] as const;

const TYPE_OPTIONS = [
  ["", "전체"],
  ["expense", "지출"],
  ["income", "수입"],
  ["transfer", "이체"],
] as const;

const HIDDEN_OPTIONS = [
  ["exclude", "제외"],
  ["include", "포함"],
  ["only", "숨김만"],
] as const;

const SOURCE_OPTIONS: readonly { readonly value: Source; readonly label: string }[] = [
  { value: "manual", label: "직접 입력" },
  { value: "kakaobank_excel", label: "카카오뱅크 파일" },
  { value: "kakaobank_sms", label: "카카오뱅크 문자" },
  { value: "recurring", label: "반복 기록" },
  { value: "import", label: "가져오기" },
  { value: "card_payment", label: "카드 대금" },
];

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
      title="필터"
      footer={
        <div className="filter-actions">
          <Button variant="secondary" onClick={() => onChange(EMPTY_FILTERS)}>
            초기화
          </Button>
          <Button variant="primary" onClick={() => onApply(filters)}>
            적용
          </Button>
        </div>
      }
    >
      <div className="filter-form">
        <fieldset className="filter-group">
          <legend className="filter-label">기간</legend>
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
                label={name === "from" ? "시작일" : "종료일"}
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
          <legend className="filter-label">거래 유형</legend>
          <div className="filter-chip-row">
            {TYPE_OPTIONS.map(([value, label]) => (
              <Chip key={value || "all"} selected={filters.type === value} onClick={() => update({ type: value })}>
                {label}
              </Chip>
            ))}
          </div>
        </fieldset>

        <fieldset className="filter-group">
          <legend className="filter-label">분류</legend>
          <label className="filter-option">
            <input
              type="checkbox"
              checked={filters.categoryIds.includes("uncategorized")}
              onChange={() => toggleCategory("uncategorized")}
            />
            <span>미분류</span>
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
            <p className="filter-hint">선택할 분류가 없어요</p>
          )}
        </fieldset>

        <Field label="자산">
          {(control) => (
            <Select
              {...control}
              value={filters.assetId}
              onChange={(event) => update({ assetId: event.currentTarget.value })}
            >
              <option value="">모든 자산</option>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <fieldset className="filter-group">
          <legend className="filter-label">금액</legend>
          <div className="filter-amount-fields">
            {(["min", "max"] as const).map((name) => (
              <FilterInput
                key={name}
                label={name === "min" ? "최소 금액" : "최대 금액"}
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

        <Field label="입력 방식">
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
              <option value="">전체 입력 방식</option>
              {SOURCE_OPTIONS.map((source) => (
                <option key={source.value} value={source.value}>
                  {source.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <p className="filter-hint">자동 기록 전체 필터는 API에서 지원하지 않아 개별 입력 방식을 선택해 주세요.</p>

        <fieldset className="filter-group">
          <legend className="filter-label">숨김 기록</legend>
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
