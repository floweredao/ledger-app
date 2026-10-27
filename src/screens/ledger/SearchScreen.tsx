import { Filter, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  type Asset,
  type Category,
  type CategoryNode,
  type Source,
  SourceSchema,
  type Transaction,
  type TransactionList,
  TransactionTypeSchema,
} from "../../../shared/schema";
import { download, paths } from "../../api/client";
import { useApi } from "../../api/hooks";
import { isPendingTransaction } from "../../api/outbox";
import { openEntry } from "../../app/entry-bridge";
import { rowCategoryLabel, TRANSFER_ICON, transferRoute } from "../../app/transaction-label";
import { AmountText } from "../../components/AmountText";
import { Button } from "../../components/Button";
import { CategoryIcon } from "../../components/CategoryIcon";
import { FilterChip } from "../../components/Chip";
import { EmptyState } from "../../components/EmptyState";
import { Field, Input } from "../../components/Field";
import { Badge, ListRow } from "../../components/ListRow";
import { Skeleton } from "../../components/Skeleton";
import { TransactionContinuation } from "../../components/TransactionContinuation";
import { useMessages } from "../../i18n";
import { common } from "../../i18n/common";
import { formatNumber, formatSigned, formatWon } from "../../i18n/format";
import { navigate, useRoute } from "../../router";
import FilterSheet, { EMPTY_FILTERS, type SearchFilters } from "./FilterSheet";
import { ledgerMessages } from "./messages";
import "./search.css";

// allow: SIZE_OK — The scoped screen file owns the complete search route and its visual result states.

function transactionQuery(text: string, filters: SearchFilters) {
  return {
    q: text.trim() || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    type: filters.type || undefined,
    category_id: filters.categoryIds.length === 1 ? filters.categoryIds[0] : undefined,
    asset_id: filters.assetId || undefined,
    min: filters.min === "" ? undefined : Number(filters.min),
    max: filters.max === "" ? undefined : Number(filters.max),
    source: filters.source || undefined,
    hidden: filters.hidden,
  };
}

function TransactionRow({
  transaction,
  categories,
  assets,
}: {
  readonly transaction: Transaction;
  readonly categories: readonly Category[];
  readonly assets: readonly Asset[];
}) {
  const m = useMessages(ledgerMessages);
  const c = useMessages(common);
  const SOURCE_LABELS: Readonly<Record<Source, string>> = {
    manual: m.manual,
    kakaobank_excel: m.bankFile,
    kakaobank_sms: m.bankText,
    recurring: m.recurring,
    import: m.imported,
    card_payment: m.cardPayment,
  };

  const category = categories.find((item) => item.id === transaction.category_id);
  const asset = assets.find((item) => item.id === transaction.asset_id);
  const isAuto = transaction.source !== "manual";
  const foreignAmount =
    transaction.currency !== "KRW" && transaction.foreign_amount !== null
      ? `${transaction.type === "expense" && !transaction.is_refund ? "-" : transaction.type === "transfer" ? "" : "+"}${transaction.currency} ${formatNumber(transaction.foreign_amount, { maximumFractionDigits: 4 })}`
      : null;
  const badges = (
    <>
      {isPendingTransaction(transaction.id) ? <Badge tone="accent">{m.pending}</Badge> : null}
      {transaction.is_refund ? <Badge tone="accent">{c.refund}</Badge> : null}
      {transaction.hidden ? <Badge>{m.hidden}</Badge> : null}
      {transaction.krw_status === "pending" ? <Badge tone="warning">{m.pendingKrw}</Badge> : null}
      {isAuto ? (
        <span
          className="search-source-dot"
          role="img"
          aria-label={m.automaticRecord(SOURCE_LABELS[transaction.source])}
        />
      ) : null}
    </>
  );
  const route = transferRoute(transaction, (id) => assets.find((item) => item.id === id)?.name);
  const title = transaction.merchant.trim()
    ? transaction.merchant
    : transaction.type === "transfer"
      ? c.transfer
      : (category?.name ?? m.noCategory);
  const categoryLabel = rowCategoryLabel(
    transaction.category_id,
    (id) => categories.find((item) => item.id === id),
    title,
  );
  const subtitle = [categoryLabel, transaction.memo, route ?? asset?.name ?? transaction.src_account]
    .filter(Boolean)
    .join(" · ");
  return (
    <ListRow
      leading={
        <CategoryIcon
          icon={category?.icon ?? (transaction.type === "transfer" ? TRANSFER_ICON : undefined)}
          color={category?.color}
        />
      }
      title={title}
      subtitle={subtitle || undefined}
      badges={badges}
      trailing={
        <span className="search-row-amount">
          {transaction.krw_status === "pending" && transaction.amount === 0 && foreignAmount ? (
            <span className="num">{foreignAmount}</span>
          ) : (
            <>
              <AmountText type={transaction.type} amount={transaction.amount} isRefund={transaction.is_refund} />
              {foreignAmount ? <span className="search-row-foreign num">{foreignAmount}</span> : null}
            </>
          )}
        </span>
      }
      onClick={() => openEntry({ id: transaction.id })}
    />
  );
}

export default function SearchScreen() {
  const m = useMessages(ledgerMessages);
  const c = useMessages(common);
  const SOURCE_LABELS: Readonly<Record<Source, string>> = {
    manual: m.manual,
    kakaobank_excel: m.bankFile,
    kakaobank_sms: m.bankText,
    recurring: m.recurring,
    import: m.imported,
    card_payment: m.cardPayment,
  };

  const route = useRoute();
  const routeText = route.query.get("q") ?? "";
  const [text, setText] = useState(routeText);
  const filters: SearchFilters = useMemo(() => {
    const type = TransactionTypeSchema.safeParse(route.query.get("type"));
    const source = SourceSchema.safeParse(route.query.get("source"));
    const hidden = route.query.get("hidden");
    const categoryId = route.query.get("category_id");
    return {
      from: route.query.get("from") ?? "",
      to: route.query.get("to") ?? "",
      type: type.success ? type.data : "",
      categoryIds: categoryId ? [categoryId] : [],
      assetId: route.query.get("asset_id") ?? "",
      min: route.query.get("min") ?? "",
      max: route.query.get("max") ?? "",
      source: source.success ? source.data : "",
      hidden: hidden === "include" || hidden === "only" ? hidden : "exclude",
    };
  }, [route.query]);
  const [draft, setDraft] = useState<SearchFilters>(EMPTY_FILTERS);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [filterError, setFilterError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  useEffect(() => {
    setText(routeText);
  }, [routeText]);
  useEffect(() => {
    if (text === routeText) return;
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams(route.query);
      if (text.trim()) query.set("q", text.trim());
      else query.delete("q");
      navigate(`${route.path}${query.size ? `?${query}` : ""}`, { replace: true });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [text, routeText, route]);

  const categoryState = useApi<{ readonly items: readonly CategoryNode[] }>(paths.categories({ include_hidden: true }));
  const assetState = useApi<{ readonly items: readonly Asset[] }>(paths.assets({ include_hidden: true }));
  const query = useMemo(() => transactionQuery(routeText, filters), [routeText, filters]);
  const filtersValid = !(filters.min !== "" && filters.max !== "" && Number(filters.min) > Number(filters.max));
  const result = useApi<TransactionList>(filtersValid ? paths.transactions(query) : null);
  const transactions = result.data?.items ?? [];
  const categories = (categoryState.data?.items ?? []).flatMap((category) => [category, ...(category.children ?? [])]);
  const assets = assetState.data?.items ?? [];
  const exportHref = (format: "csv" | "xlsx") => `/api/v1/${paths.exportFile({ ...query, format })}`;
  const exportResults = async (format: "csv" | "xlsx") => {
    if (exporting) return;
    setExporting(true);
    setExportError("");
    try {
      await download(paths.exportFile({ ...query, format }));
    } catch {
      setExportError(m.exportFailed);
    } finally {
      setExporting(false);
    }
  };
  const appliedCount = [
    filters.from || filters.to,
    filters.type,
    filters.categoryIds.length,
    filters.assetId,
    filters.min || filters.max,
    filters.source,
    filters.hidden !== "exclude",
  ].filter(Boolean).length;
  const filterSummary = [
    filters.from || filters.to ? `${filters.from || m.beginning} ~ ${filters.to || m.today}` : "",
    filters.type === "income"
      ? c.income
      : filters.type === "expense"
        ? c.expense
        : filters.type === "transfer"
          ? c.transfer
          : "",
    filters.categoryIds
      .map((id) => (id === "uncategorized" ? c.uncategorized : categories.find((category) => category.id === id)?.name))
      .filter(Boolean)
      .join(", "),
    filters.assetId ? (assets.find((asset) => asset.id === filters.assetId)?.name ?? m.asset) : "",
    filters.min || filters.max ? m.amountRange(filters.min, filters.max) : "",
    filters.source ? SOURCE_LABELS[filters.source] : "",
    filters.hidden === "only" ? m.hiddenOnly : filters.hidden === "include" ? m.includeHidden : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const applyFilters = (next: SearchFilters) => {
    if (next.min !== "" && next.max !== "" && Number(next.min) > Number(next.max)) {
      setFilterError(m.invalidAmountRange);
      return;
    }
    if (next.from && next.to && next.from > next.to) {
      setFilterError(m.invalidDateRange);
      return;
    }
    setFilterError("");
    navigate(paths.transactions(transactionQuery(text, next)).replace(/^transactions/, "/search"), { replace: true });
    setSheetOpen(false);
  };

  const resetFilters = () => {
    navigate(text.trim() ? `/search?${new URLSearchParams({ q: text.trim() })}` : "/search", { replace: true });
    setDraft(EMPTY_FILTERS);
    setFilterError("");
  };

  return (
    <section className="screen search-screen">
      <header className="screen-header">
        <h1 className="screen-title">{m.search}</h1>
      </header>
      <div className="search-controls">
        <Field label={m.searchTerm}>
          {(control) => (
            <span className="search-input-wrap">
              <Search aria-hidden="true" size={18} />
              <Input
                {...control}
                type="search"
                role="searchbox"
                value={text}
                onChange={(event) => setText(event.currentTarget.value)}
                placeholder={m.searchPlaceholder}
              />
              {text ? (
                <button className="search-clear" type="button" aria-label={m.clearSearch} onClick={() => setText("")}>
                  <X aria-hidden="true" size={18} />
                </button>
              ) : null}
            </span>
          )}
        </Field>
        <Button
          icon={Filter}
          aria-label={appliedCount ? m.appliedFilterCount(appliedCount) : m.filters}
          onClick={() => {
            setDraft(filters);
            setFilterError("");
            setSheetOpen(true);
          }}
        >
          {m.filters}
          {appliedCount ? ` ${formatNumber(appliedCount)}` : ""}
        </Button>
      </div>

      {appliedCount ? (
        <section className="search-filter-chips" aria-label={m.appliedFilters}>
          <FilterChip removeLabel={m.clearFilters} onRemove={resetFilters}>
            {filterSummary}
          </FilterChip>
        </section>
      ) : null}

      <section className="search-results" aria-label={m.searchResults}>
        <div className="search-results-heading">
          <div>
            <h2 className="section-title">{m.transactions}</h2>
            <p className="search-result-count">
              {result.data ? c.count(result.data.totals.count) : m.searching}
              {result.offline ? m.offlineSuffix : ""}
            </p>
          </div>
          <nav className="search-exports" aria-label={c.export} aria-busy={exporting}>
            <span>{c.export}</span>
            <a
              href={exportHref("csv")}
              aria-label={m.exportCsv}
              aria-disabled={exporting}
              onClick={(event) => {
                event.preventDefault();
                void exportResults("csv");
              }}
            >
              {m.csv}
            </a>
            <a
              href={exportHref("xlsx")}
              aria-label={m.exportExcel}
              aria-disabled={exporting}
              onClick={(event) => {
                event.preventDefault();
                void exportResults("xlsx");
              }}
            >
              {m.excel}
            </a>
          </nav>
        </div>
        {exportError ? (
          <p className="field-error" role="alert">
            {exportError}
          </p>
        ) : null}

        {result.data ? (
          <dl className="search-totals" aria-label={m.searchTotals}>
            <div>
              <dt>{c.income}</dt>
              <dd className="num" data-kind="income">
                {formatSigned("income", result.data.totals.income)}
              </dd>
            </div>
            <div>
              <dt>{c.expense}</dt>
              <dd className="num" data-kind="expense">
                {formatSigned("expense", result.data.totals.expense)}
              </dd>
            </div>
            <div>
              <dt>{m.netTotal}</dt>
              <dd className="num">
                {result.data.totals.net < 0
                  ? `-${formatWon(-result.data.totals.net)}`
                  : `+${formatWon(result.data.totals.net)}`}
              </dd>
            </div>
          </dl>
        ) : null}

        {result.data === undefined && result.loading ? (
          <div className="search-skeletons" role="status" aria-label={m.loadingResults}>
            <Skeleton variant="rows" label={m.loading} />
          </div>
        ) : result.data === undefined ? (
          <EmptyState
            tone="error"
            title={m.loadResultsFailed}
            action={
              <Button size="sm" onClick={result.reload}>
                {c.retry}
              </Button>
            }
          />
        ) : transactions.length === 0 ? (
          <EmptyState
            icon={Search}
            title={m.emptyResults}
            description={m.emptyResultsHint}
            action={<Button onClick={resetFilters}>{m.resetFilters}</Button>}
          />
        ) : (
          <div className="search-result-list">
            {transactions.map((transaction) => (
              <TransactionRow key={transaction.id} transaction={transaction} categories={categories} assets={assets} />
            ))}
            <TransactionContinuation
              key={`${paths.transactions(query)}:${result.data.next_cursor}`}
              query={query}
              cursor={result.data.next_cursor}
              seenIds={transactions.map((transaction) => transaction.id)}
              renderRows={(items) =>
                items.map((transaction) => (
                  <TransactionRow
                    key={transaction.id}
                    transaction={transaction}
                    categories={categories}
                    assets={assets}
                  />
                ))
              }
            />
          </div>
        )}
      </section>

      <FilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        filters={draft}
        onChange={setDraft}
        onApply={applyFilters}
        error={filterError}
        categories={categories}
        assets={assets}
      />
    </section>
  );
}
