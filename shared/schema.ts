import { z } from "zod";

export const MAX_AMOUNT = 1_000_000_000_000;
const id = z.string().min(1);
const nullableId = id.nullable();
const timestamp = z.string();
const isoDateTime = z.iso.datetime({ offset: true });
const date = z.iso.date();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM");
const amount = z.number().int().min(0).max(MAX_AMOUNT);
const day = z.number().int().min(1).max(31);
const name = z.string().trim().min(1).max(60);

export const TransactionTypeSchema = z.enum(["expense", "income", "transfer"]);
export const CategoryTypeSchema = z.enum(["expense", "income"]);
export const AssetKindSchema = z.enum(["cash", "bank", "check_card", "credit_card", "savings", "loan", "other"]);
export const KrwStatusSchema = z.enum(["exact", "inferred", "pending"]);
export const SourceSchema = z.enum([
  "manual",
  "kakaobank_excel",
  "kakaobank_sms",
  "recurring",
  "import",
  "card_payment",
]);
export const ThemeSchema = z.enum(["system", "light", "dark"]);
export const FreqSchema = z.enum(["daily", "weekly", "monthly", "yearly"]);
/** The ledger tab `/` opens on. */
export const LedgerViewSchema = z.enum(["daily", "calendar", "monthly"]);
export type LedgerView = z.infer<typeof LedgerViewSchema>;
export type TransactionType = z.infer<typeof TransactionTypeSchema>;
export type CategoryType = z.infer<typeof CategoryTypeSchema>;
export type AssetKind = z.infer<typeof AssetKindSchema>;
export type Source = z.infer<typeof SourceSchema>;

export const AssetSchema = z.object({
  id,
  name: z.string(),
  kind: AssetKindSchema,
  group_name: z.string(),
  opening_balance: z.number().int(),
  opening_date: date.nullable(),
  linked_asset_id: nullableId,
  settlement_day: day.nullable(),
  payment_day: day.nullable(),
  performance_target: amount.nullable(),
  external_ref: z.string().nullable(),
  sort: z.number().int(),
  hidden: z.boolean(),
  created_at: timestamp,
  updated_at: timestamp,
});
export const AssetInputSchema = z
  .object({
    name,
    kind: AssetKindSchema,
    group_name: z.string().trim().max(40).default(""),
    opening_balance: z.number().int().min(-MAX_AMOUNT).max(MAX_AMOUNT).default(0),
    opening_date: date.nullable().optional(),
    linked_asset_id: nullableId.optional(),
    settlement_day: day.nullable().optional(),
    payment_day: day.nullable().optional(),
    performance_target: amount.nullable().optional(),
    sort: z.number().int().optional(),
    hidden: z.boolean().default(false),
  })
  .strict();
export const AssetPatchSchema = AssetInputSchema.partial().strict();
export type Asset = z.infer<typeof AssetSchema>;
export type AssetInput = z.infer<typeof AssetInputSchema>;
export type AssetPatch = z.infer<typeof AssetPatchSchema>;

export const AssetSummaryRowSchema = AssetSchema.extend({
  balance: z.number().int(),
  usage: z.number().int().nullable(),
  cycle: z.object({ from: date, to: date }).nullable(),
  payment_date: date.nullable(),
  expected_payment: z.number().int().nullable(),
  performance: z.object({ target: z.number().int(), achieved: z.number().int(), pct: z.number() }).nullable(),
  reported_balance: z.number().int().nullable(),
  reported_at: timestamp.nullable(),
  mismatch: z.number().int().nullable(),
});
export const AssetSummarySchema = z.object({
  assets: z.array(AssetSummaryRowSchema),
  totals: z.object({ assets: z.number().int(), debts: z.number().int(), net_worth: z.number().int() }),
});
export type AssetSummary = z.infer<typeof AssetSummarySchema>;

export const CategorySchema = z.object({
  id,
  type: CategoryTypeSchema,
  parent_id: nullableId,
  name: z.string(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  sort: z.number().int(),
  hidden: z.boolean(),
  created_at: timestamp,
  updated_at: timestamp,
});
export type Category = z.infer<typeof CategorySchema>;
export type CategoryNode = Category & { readonly children: readonly Category[] };
export const CategoryInputSchema = z
  .object({
    type: CategoryTypeSchema,
    parent_id: nullableId.optional(),
    name: z.string().trim().min(1).max(30),
    icon: z.string().max(40).nullable().optional(),
    color: z.string().max(40).nullable().optional(),
  })
  .strict();
export const CategoryPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(30),
    icon: z.string().max(40).nullable(),
    color: z.string().max(40).nullable(),
    hidden: z.boolean(),
    sort: z.number().int(),
    parent_id: nullableId,
  })
  .partial()
  .strict();
/** What still points at a category; `deleted_transactions` are records in the trash. */
export type CategoryUsage = {
  readonly transactions: number;
  readonly deleted_transactions: number;
  readonly budgets: number;
  readonly merchant_rules: number;
  readonly recurring_rules: number;
  readonly templates: number;
  readonly children: number;
};
/** What a delete with `reassign_to` moved; `transactions` includes records in the trash. */
export type ReassignedCounts = Omit<CategoryUsage, "deleted_transactions">;
export const ReorderSchema = z.object({ ids: z.array(id).min(1).max(500) }).strict();
export type CategoryInput = z.infer<typeof CategoryInputSchema>;
export type CategoryPatch = z.infer<typeof CategoryPatchSchema>;

export const MerchantRuleSchema = z.object({
  merchant_key: z.string(),
  category_id: id,
  category_name: z.string(),
  type: TransactionTypeSchema,
  updated_at: timestamp,
});
export type MerchantRule = z.infer<typeof MerchantRuleSchema>;

export const TransactionSchema = z.object({
  id,
  type: TransactionTypeSchema,
  occurred_at: timestamp,
  amount: z.number().int(),
  is_refund: z.boolean(),
  currency: z.string(),
  foreign_amount: z.number().nullable(),
  krw_status: KrwStatusSchema,
  asset_id: nullableId,
  to_asset_id: nullableId,
  category_id: nullableId,
  merchant: z.string(),
  merchant_key: z.string(),
  memo: z.string(),
  source: SourceSchema,
  source_key: z.string().nullable(),
  src_account: z.string().nullable(),
  src_amount: z.number().nullable(),
  src_at: z.string().nullable(),
  hidden: z.boolean(),
  hidden_reason: z.string().nullable(),
  user_locked: z.array(z.string()),
  recurring_rule_id: nullableId,
  deleted_at: timestamp.nullable(),
  created_at: timestamp,
  updated_at: timestamp,
});
export type Transaction = z.infer<typeof TransactionSchema>;

const transactionFields = {
  type: TransactionTypeSchema,
  occurred_at: isoDateTime,
  amount,
  is_refund: z.boolean(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  foreign_amount: z.number().positive().nullable(),
  krw_status: KrwStatusSchema,
  asset_id: nullableId,
  to_asset_id: nullableId,
  category_id: nullableId,
  merchant: z.string().trim().max(100),
  memo: z.string().max(500),
};
const transferAssets = (value: {
  type: TransactionType;
  asset_id?: string | null | undefined;
  to_asset_id?: string | null | undefined;
}) => value.type !== "transfer" || (value.to_asset_id != null && value.to_asset_id !== value.asset_id);

/** Client input; the importer-owned `src_*` columns are rejected by `.strict()`. */
export const TransactionInputSchema = z
  .object({
    id: z.uuid().optional(),
    type: transactionFields.type,
    occurred_at: transactionFields.occurred_at,
    amount: transactionFields.amount,
    is_refund: transactionFields.is_refund.default(false),
    currency: transactionFields.currency.default("KRW"),
    foreign_amount: transactionFields.foreign_amount.optional(),
    krw_status: transactionFields.krw_status.default("exact"),
    asset_id: transactionFields.asset_id.optional(),
    to_asset_id: transactionFields.to_asset_id.optional(),
    category_id: transactionFields.category_id.optional(),
    merchant: transactionFields.merchant.default(""),
    memo: transactionFields.memo.default(""),
  })
  .strict()
  .refine(transferAssets, { message: "A transfer needs a different to_asset_id", path: ["to_asset_id"] });
export const TransactionPatchSchema = z
  .object({
    ...transactionFields,
    hidden: z.boolean(),
    hidden_reason: z.string().max(200).nullable(),
  })
  .partial()
  .extend({ learn: z.boolean().optional(), apply_to_past: z.boolean().optional() })
  .strict();
export type TransactionInput = z.infer<typeof TransactionInputSchema>;
export type TransactionPatch = z.infer<typeof TransactionPatchSchema>;

const numberParam = z.coerce.number().int().min(0).max(MAX_AMOUNT);
export const TransactionListQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().max(100).optional(),
  type: TransactionTypeSchema.optional(),
  category_id: id.optional(),
  asset_id: id.optional(),
  min: numberParam.optional(),
  max: numberParam.optional(),
  source: SourceSchema.optional(),
  hidden: z.enum(["exclude", "include", "only"]).default("exclude"),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  cursor: z.string().optional(),
});
export type TransactionListQuery = z.infer<typeof TransactionListQuerySchema>;

export const TotalsSchema = z.object({
  income: z.number().int(),
  expense: z.number().int(),
  net: z.number().int(),
  count: z.number().int(),
});
export const TransactionListSchema = z.object({
  items: z.array(TransactionSchema),
  totals: TotalsSchema,
  next_cursor: z.string().nullable(),
});
export type Totals = z.infer<typeof TotalsSchema>;
export type TransactionList = z.infer<typeof TransactionListSchema>;

const budgetCategory = z.union([id, z.literal("")]);
const budgetMonth = z.union([month, z.literal("")]);
/** `category_id` '' = the total budget; `month` '' = the default for every month (DB sentinels, never NULL). */
export const BudgetSchema = z.object({ id, category_id: budgetCategory, month: budgetMonth, amount });
export const BudgetPutSchema = z
  .object({ category_id: budgetCategory.default(""), month: budgetMonth.default(""), amount })
  .strict();
const budgetLine = z.object({
  budget_id: id.nullable(),
  budget_month: budgetMonth.nullable(),
  budget: z.number().int().nullable(),
  spent: z.number().int(),
  remaining: z.number().int().nullable(),
  pct: z.number().nullable(),
  over: z.boolean(),
});
export const BudgetStatusSchema = z.object({
  month,
  range: z.object({ from: date, to: date }),
  total: budgetLine,
  categories: z.array(
    budgetLine.extend({ category_id: id, name: z.string(), icon: z.string().nullable(), color: z.string().nullable() }),
  ),
});
export type Budget = z.infer<typeof BudgetSchema>;
export type BudgetPut = z.infer<typeof BudgetPutSchema>;
export type BudgetStatus = z.infer<typeof BudgetStatusSchema>;

export const TemplatePayloadSchema = z
  .object({
    type: transactionFields.type,
    amount: transactionFields.amount.optional(),
    is_refund: transactionFields.is_refund.optional(),
    asset_id: transactionFields.asset_id.optional(),
    to_asset_id: transactionFields.to_asset_id.optional(),
    category_id: transactionFields.category_id.optional(),
    merchant: transactionFields.merchant.optional(),
    memo: transactionFields.memo.optional(),
  })
  .strict();
export type TemplatePayload = z.infer<typeof TemplatePayloadSchema>;

export const RecurringRuleSchema = z.object({
  id,
  template: TemplatePayloadSchema,
  freq: FreqSchema,
  interval: z.number().int().min(1),
  start_date: date,
  end_date: date.nullable(),
  last_materialized_date: date.nullable(),
  active: z.boolean(),
  created_at: timestamp,
  updated_at: timestamp,
});
export const RecurringInputSchema = z
  .object({
    template: TemplatePayloadSchema.refine((value) => value.amount !== undefined, "amount is required"),
    freq: FreqSchema,
    interval: z.number().int().min(1).max(366).default(1),
    start_date: date,
    end_date: date.nullable().optional(),
    active: z.boolean().default(true),
  })
  .strict();
export const RecurringPatchSchema = RecurringInputSchema.partial().strict();
export type RecurringRule = z.infer<typeof RecurringRuleSchema>;
export type RecurringInput = z.infer<typeof RecurringInputSchema>;

export const TemplateSchema = z.object({
  id,
  name: z.string(),
  payload: TemplatePayloadSchema,
  sort: z.number().int(),
  use_count: z.number().int(),
  created_at: timestamp,
  updated_at: timestamp,
});
export const TemplateInputSchema = z
  .object({ name: z.string().trim().min(1).max(40), payload: TemplatePayloadSchema, sort: z.number().int().optional() })
  .strict();
export const TemplatePatchSchema = TemplateInputSchema.partial().strict();
export type Template = z.infer<typeof TemplateSchema>;
export type TemplateInput = z.infer<typeof TemplateInputSchema>;

export const SettingsSchema = z.object({
  month_start_day: z.number().int().min(1).max(28),
  owner_name: z.string().max(40),
  theme: ThemeSchema,
  default_asset_id: nullableId,
  ledger_view: LedgerViewSchema,
});
export const SettingsPatchSchema = SettingsSchema.partial().strict();
export type Settings = z.infer<typeof SettingsSchema>;
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;
export const DEFAULT_SETTINGS: Settings = {
  month_start_day: 1,
  owner_name: "",
  theme: "system",
  default_asset_id: null,
  ledger_view: "daily",
};

export const SessionStateSchema = z.object({
  authenticated: z.boolean(),
  csrf_token: z.string().nullable(),
  expires_at: timestamp.nullable(),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

export const SyncStatusSchema = z.object({
  last_run_at: timestamp.nullable(),
  last_result: z.unknown(),
  last_error: z.string().nullable(),
  next_run_at: timestamp.nullable(),
});
export type SyncStatus = z.infer<typeof SyncStatusSchema>;

export const RangeQuerySchema = z.object({ from: date, to: date });
export const StatsSummarySchema = TotalsSchema;
const categoryAmount = z.object({
  category_id: nullableId,
  name: z.string(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  amount: z.number().int(),
  pct: z.number(),
});
export const StatsCategoriesSchema = z.object({
  total: z.number().int(),
  rows: z.array(categoryAmount.extend({ children: z.array(categoryAmount) })),
});
export const StatsTrendSchema = z.object({
  buckets: z.array(
    z.object({
      month,
      from: date,
      to: date,
      income: z.number().int(),
      expense: z.number().int(),
      net: z.number().int(),
    }),
  ),
});
export const StatsCompareSchema = z.object({
  range: z.object({ from: date, to: date }),
  previous_range: z.object({ from: date, to: date }),
  rows: z.array(
    z.object({
      category_id: nullableId,
      name: z.string(),
      current: z.number().int(),
      previous: z.number().int(),
      delta: z.number().int(),
      pct_change: z.number().nullable(),
    }),
  ),
});
export const StatsMerchantsSchema = z.object({
  rows: z.array(
    z.object({ merchant: z.string(), merchant_key: z.string(), amount: z.number().int(), count: z.number().int() }),
  ),
});
export const StatsAssetsSchema = z.object({
  rows: z.array(z.object({ asset_id: id, name: z.string(), income: z.number().int(), expense: z.number().int() })),
});
export const StatsCalendarSchema = z.object({
  month,
  range: z.object({ from: date, to: date }),
  days: z.array(z.object({ date, income: z.number().int(), expense: z.number().int(), count: z.number().int() })),
});
export type StatsSummary = z.infer<typeof StatsSummarySchema>;
export type StatsCategories = z.infer<typeof StatsCategoriesSchema>;
export type StatsTrend = z.infer<typeof StatsTrendSchema>;
export type StatsCompare = z.infer<typeof StatsCompareSchema>;
export type StatsMerchants = z.infer<typeof StatsMerchantsSchema>;
export type StatsAssets = z.infer<typeof StatsAssetsSchema>;
export type StatsCalendar = z.infer<typeof StatsCalendarSchema>;

export type ApiErrorBody = { readonly error: { readonly code: string; readonly message: string } };
