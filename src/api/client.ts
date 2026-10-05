import type { z } from "zod";
import type {
  Asset,
  AssetInput,
  AssetPatch,
  AssetSummary,
  Budget,
  BudgetStatus,
  Category,
  CategoryInput,
  CategoryPatch,
  CategoryUsage,
  MerchantRule,
  ReassignedCounts,
  RecurringRule,
  SessionState,
  Settings,
  SettingsPatch,
  StatsAssets,
  StatsCalendar,
  StatsCategories,
  StatsCompare,
  StatsMerchants,
  StatsSummary,
  StatsTrend,
  SyncStatus,
  Template,
  Transaction,
  TransactionInputSchema,
  TransactionList,
  TransactionListQuery,
  TransactionPatch,
  TransactionType,
} from "../../shared/schema";
import { uuidv7 } from "./ids";
import { type QueuedMutation, sendMutation } from "./outbox";
import { apiFetch, apiJson, markLoggedOut, setCsrfToken } from "./transport";

export { ApiError, isApiError, isNetworkError, NetworkError } from "./transport";

type Param = string | number | boolean | null | undefined;
export type Params = Readonly<Record<string, Param>>;

export function withQuery(path: string, params?: Params): string {
  if (!params) return path;
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(name, String(value));
  }
  const query = search.toString();
  return query === "" ? path : `${path}?${query}`;
}

export type DateFilter = { readonly from: string; readonly to: string };
export type TransactionQuery = Partial<Record<keyof TransactionListQuery, Param>>;
export type StatsQuery = DateFilter & { readonly type?: TransactionType };
export type ExportQuery = TransactionQuery & { readonly format: "csv" | "xlsx" };
export type TransactionCreate = z.input<typeof TransactionInputSchema>;
export type Items<T> = { readonly items: readonly T[] };
export type MutationResult<T> = T | QueuedMutation;
export type SyncResult = {
  readonly inserted: number;
  readonly merged: number;
  readonly skipped: number;
  readonly hidden: number;
  readonly errors: readonly string[];
};

/** Cache keys (`useApi(key)`) and GET paths are the same strings, relative to `/api/v1/`. */
export const paths = {
  session: "auth/session",
  transactions: (q?: TransactionQuery) => withQuery("transactions", q),
  transaction: (id: string) => `transactions/${encodeURIComponent(id)}`,
  categories: (q?: { type?: "expense" | "income"; include_hidden?: boolean }) => withQuery("categories", q),
  merchantRules: "merchant-rules",
  assets: (q?: { include_hidden?: boolean }) => withQuery("assets", q),
  assetsSummary: "assets/summary",
  budgets: (month: string) => withQuery("budgets", { month }),
  recurring: "recurring",
  templates: "templates",
  statsSummary: (q: StatsQuery) => withQuery("stats/summary", q),
  statsCategories: (q: StatsQuery) => withQuery("stats/categories", q),
  statsTrend: (q: { months?: number; end?: string; type?: TransactionType; basis?: "accounting" | "calendar" }) =>
    withQuery("stats/trend", q),
  statsCompare: (q: StatsQuery) => withQuery("stats/compare", q),
  statsMerchants: (q: DateFilter & { limit?: number }) => withQuery("stats/merchants", q),
  statsAssets: (q: DateFilter) => withQuery("stats/assets", q),
  statsCalendar: (month: string) => withQuery("stats/calendar", { month }),
  settings: "settings",
  syncStatus: "sync/status",
  exportFile: (q: ExportQuery) => withQuery("export", q),
  backup: "backup",
} as const;

export function applySession(state: SessionState): SessionState {
  setCsrfToken(state.authenticated ? state.csrf_token : null);
  return state;
}

const send = <T>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, json?: unknown) =>
  apiJson<T>(path, { method, json });

const enc = encodeURIComponent;

export const api = {
  get: <T>(key: string) => apiJson<T>(key),

  session: () => apiJson<SessionState>(paths.session).then(applySession),
  login: (token: string) => send<SessionState>("POST", paths.session, { token }).then(applySession),
  logout: async () => {
    const session = await send<SessionState>("DELETE", paths.session);
    markLoggedOut();
    return session;
  },

  listTransactions: (q?: TransactionQuery) => apiJson<TransactionList>(paths.transactions(q)),
  getTransaction: (id: string) => apiJson<Transaction>(paths.transaction(id)),
  createTransaction: (input: TransactionCreate) =>
    sendMutation({
      id: uuidv7(),
      method: "POST",
      path: "transactions",
      body: { ...input, id: input.id ?? uuidv7() },
    }) as Promise<MutationResult<Transaction>>,
  patchTransaction: (id: string, patch: TransactionPatch) =>
    sendMutation({ id: uuidv7(), method: "PATCH", path: `transactions/${enc(id)}`, body: patch }) as Promise<
      MutationResult<Transaction>
    >,
  deleteTransaction: (id: string) =>
    sendMutation({ id: uuidv7(), method: "DELETE", path: `transactions/${enc(id)}` }) as Promise<
      MutationResult<Transaction>
    >,
  restoreTransaction: (id: string) =>
    sendMutation({ id: uuidv7(), method: "POST", path: `transactions/${enc(id)}/restore` }) as Promise<
      MutationResult<Transaction>
    >,

  createCategory: (input: CategoryInput) => send<Category>("POST", "categories", input),
  patchCategory: (id: string, patch: CategoryPatch) => send<Category>("PATCH", `categories/${enc(id)}`, patch),
  deleteCategory: (id: string, reassignTo?: string) =>
    send<{ ok: true; moved: ReassignedCounts }>(
      "DELETE",
      withQuery(`categories/${enc(id)}`, { reassign_to: reassignTo }),
    ),
  categoryUsage: (id: string) => apiJson<CategoryUsage>(`categories/${enc(id)}/usage`),
  reorderCategories: (ids: readonly string[]) => send<{ ok: true }>("POST", "categories/reorder", { ids }),
  deleteMerchantRule: (merchantKey: string, type?: TransactionType) =>
    send<{ ok: true }>("DELETE", withQuery(`merchant-rules/${enc(merchantKey)}`, { type })),
  listMerchantRules: () => apiJson<Items<MerchantRule>>(paths.merchantRules),

  createAsset: (input: AssetInput) => send<Asset>("POST", "assets", input),
  patchAsset: (id: string, patch: AssetPatch) => send<Asset>("PATCH", `assets/${enc(id)}`, patch),
  deleteAsset: (id: string) => send<{ ok: true }>("DELETE", `assets/${enc(id)}`),
  assetsSummary: () => apiJson<AssetSummary>(paths.assetsSummary),
  cardPayment: (id: string, body: { amount?: number; date?: string } = {}) =>
    send<Transaction>("POST", `assets/${enc(id)}/card-payment`, body),

  budgets: (month: string) => apiJson<BudgetStatus>(paths.budgets(month)),
  putBudget: (body: { category_id?: string; month?: string; amount: number }) => send<Budget>("PUT", "budgets", body),
  deleteBudget: (id: string) => send<{ ok: true }>("DELETE", `budgets/${enc(id)}`),

  createRecurring: (body: unknown) => send<RecurringRule>("POST", "recurring", body),
  patchRecurring: (id: string, body: unknown) => send<RecurringRule>("PATCH", `recurring/${enc(id)}`, body),
  deleteRecurring: (id: string) => send<{ ok: true }>("DELETE", `recurring/${enc(id)}`),
  runRecurring: () => send<{ created: number }>("POST", "recurring/run"),

  createTemplate: (body: unknown) => send<Template>("POST", "templates", body),
  patchTemplate: (id: string, body: unknown) => send<Template>("PATCH", `templates/${enc(id)}`, body),
  deleteTemplate: (id: string) => send<{ ok: true }>("DELETE", `templates/${enc(id)}`),
  useTemplate: (id: string, overrides: unknown = {}) =>
    send<Transaction>("POST", `templates/${enc(id)}/use`, overrides),

  statsSummary: (q: StatsQuery) => apiJson<StatsSummary>(paths.statsSummary(q)),
  statsCategories: (q: StatsQuery) => apiJson<StatsCategories>(paths.statsCategories(q)),
  statsTrend: (q: Parameters<typeof paths.statsTrend>[0]) => apiJson<StatsTrend>(paths.statsTrend(q)),
  statsCompare: (q: StatsQuery) => apiJson<StatsCompare>(paths.statsCompare(q)),
  statsMerchants: (q: Parameters<typeof paths.statsMerchants>[0]) => apiJson<StatsMerchants>(paths.statsMerchants(q)),
  statsAssets: (q: DateFilter) => apiJson<StatsAssets>(paths.statsAssets(q)),
  statsCalendar: (month: string) => apiJson<StatsCalendar>(paths.statsCalendar(month)),

  settings: () => apiJson<Settings>(paths.settings),
  patchSettings: (patch: SettingsPatch) => send<Settings>("PATCH", paths.settings, patch),

  syncStatus: () => apiJson<SyncStatus>(paths.syncStatus),
  runSync: () => send<SyncResult>("POST", "sync/run"),

  importPreview: (file: File) => {
    const form = new FormData();
    form.set("file", file);
    return upload<unknown>("import/preview", form);
  },
  importCommit: (body: { preview_id: string; include_duplicates?: boolean }) =>
    send<{ inserted: number; skipped: number }>("POST", "import/commit", body),
  restoreBackup: async (file: File) =>
    apiJson<unknown>("backup/restore?confirm=REPLACE", {
      method: "POST",
      body: await file.text(),
      headers: { "Content-Type": "application/json" },
    }),
};

/** Multipart POST: credentials and CSRF are added, Content-Type is left to the browser's boundary. */
export function upload<T>(path: string, formData: FormData): Promise<T> {
  return apiJson<T>(path, { method: "POST", body: formData });
}

function filenameFrom(disposition: string | null): string | null {
  if (!disposition) return null;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
  if (star?.[1]) return decodeURIComponent(star[1].trim());
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
  return plain?.[1]?.trim() ?? null;
}

function isStandalone(): boolean {
  const standaloneIos = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standaloneIos || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

/**
 * Fetches a file with the session cookie. In the installed PWA (where anchors cannot save files on iOS)
 * it opens the share sheet; elsewhere, or if sharing is unsupported, it saves through an object-URL anchor.
 */
export async function download(path: string): Promise<void> {
  const response = await apiFetch(path);
  const blob = await response.blob();
  const fallbackName = path.split("?")[0]?.split("/").pop() || "download";
  const name = filenameFrom(response.headers.get("content-disposition")) ?? fallbackName;
  const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
  if (isStandalone() && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.warn("share failed, saving with a link instead", error);
    }
  }
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
