import { Filter, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatSigned, formatWon } from "../../../shared/money";
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
import { TRANSFER_ICON, transactionTitle, transferRoute } from "../../app/transaction-label";
import { AmountText } from "../../components/AmountText";
import { Button } from "../../components/Button";
import { CategoryIcon } from "../../components/CategoryIcon";
import { FilterChip } from "../../components/Chip";
import { EmptyState } from "../../components/EmptyState";
import { Field, Input } from "../../components/Field";
import { Badge, ListRow } from "../../components/ListRow";
import { Skeleton } from "../../components/Skeleton";
import { TransactionContinuation } from "../../components/TransactionContinuation";
import { navigate, useRoute } from "../../router";
import FilterSheet, { EMPTY_FILTERS, type SearchFilters } from "./FilterSheet";
import "./search.css";

// allow: SIZE_OK — The scoped screen file owns the complete search route and its visual result states.
const SOURCE_LABELS: Readonly<Record<Source, string>> = {
  manual: "직접 입력",
  kakaobank_excel: "카카오뱅크 파일",
  kakaobank_sms: "카카오뱅크 문자",
  recurring: "반복 기록",
  import: "가져오기",
  card_payment: "카드 대금",
};

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
  const category = categories.find((item) => item.id === transaction.category_id);
  const asset = assets.find((item) => item.id === transaction.asset_id);
  const isAuto = transaction.source !== "manual";
  const foreignAmount =
    transaction.currency !== "KRW" && transaction.foreign_amount !== null
      ? `${transaction.type === "expense" && !transaction.is_refund ? "-" : transaction.type === "transfer" ? "" : "+"}${transaction.currency} ${transaction.foreign_amount.toLocaleString("ko-KR", { maximumFractionDigits: 4 })}`
      : null;
  const badges = (
    <>
      {isPendingTransaction(transaction.id) ? <Badge tone="accent">대기</Badge> : null}
      {transaction.is_refund ? <Badge tone="accent">환불</Badge> : null}
      {transaction.hidden ? <Badge>숨김</Badge> : null}
      {transaction.krw_status === "pending" ? <Badge tone="warning">원화 미확정</Badge> : null}
      {isAuto ? (
        <span className="search-source-dot" role="img" aria-label={`자동 기록: ${SOURCE_LABELS[transaction.source]}`} />
      ) : null}
    </>
  );
  const route = transferRoute(transaction, (id) => assets.find((item) => item.id === id)?.name);
  const subtitle = [transaction.memo, route ?? asset?.name ?? transaction.src_account].filter(Boolean).join(" · ");
  return (
    <ListRow
      leading={
        <CategoryIcon
          icon={category?.icon ?? (transaction.type === "transfer" ? TRANSFER_ICON : undefined)}
          color={category?.color}
        />
      }
      title={transactionTitle(transaction, category?.name)}
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
      setExportError("파일을 내보내지 못했어요. 다시 시도해 주세요.");
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
    filters.from || filters.to ? `${filters.from || "처음"} ~ ${filters.to || "오늘"}` : "",
    filters.type === "income"
      ? "수입"
      : filters.type === "expense"
        ? "지출"
        : filters.type === "transfer"
          ? "이체"
          : "",
    filters.categoryIds
      .map((id) => (id === "uncategorized" ? "미분류" : categories.find((category) => category.id === id)?.name))
      .filter(Boolean)
      .join(", "),
    filters.assetId ? (assets.find((asset) => asset.id === filters.assetId)?.name ?? "자산") : "",
    filters.min || filters.max ? `${filters.min || "0"}원 ~ ${filters.max || "제한 없음"}원` : "",
    filters.source ? SOURCE_LABELS[filters.source] : "",
    filters.hidden === "only" ? "숨김만" : filters.hidden === "include" ? "숨김 포함" : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const applyFilters = (next: SearchFilters) => {
    if (next.min !== "" && next.max !== "" && Number(next.min) > Number(next.max)) {
      setFilterError("최소 금액은 최대 금액보다 클 수 없어요");
      return;
    }
    if (next.from && next.to && next.from > next.to) {
      setFilterError("시작일은 종료일보다 늦을 수 없어요");
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
        <h1 className="screen-title">검색</h1>
      </header>
      <div className="search-controls">
        <Field label="검색어">
          {(control) => (
            <span className="search-input-wrap">
              <Search aria-hidden="true" size={18} />
              <Input
                {...control}
                type="search"
                role="searchbox"
                value={text}
                onChange={(event) => setText(event.currentTarget.value)}
                placeholder="가맹점이나 메모 검색"
              />
              {text ? (
                <button className="search-clear" type="button" aria-label="검색어 지우기" onClick={() => setText("")}>
                  <X aria-hidden="true" size={18} />
                </button>
              ) : null}
            </span>
          )}
        </Field>
        <Button
          icon={Filter}
          aria-label={appliedCount ? `필터, ${appliedCount}개 적용` : "필터"}
          onClick={() => {
            setDraft(filters);
            setFilterError("");
            setSheetOpen(true);
          }}
        >
          필터{appliedCount ? ` ${appliedCount}` : ""}
        </Button>
      </div>

      {appliedCount ? (
        <section className="search-filter-chips" aria-label="적용된 필터">
          <FilterChip removeLabel="필터 모두 해제" onRemove={resetFilters}>
            {filterSummary}
          </FilterChip>
        </section>
      ) : null}

      <section className="search-results" aria-label="검색 결과">
        <div className="search-results-heading">
          <div>
            <h2 className="section-title">거래 내역</h2>
            <p className="search-result-count">
              {result.data ? `${result.data.totals.count}건` : "검색 중"}
              {result.offline ? " · 오프라인 저장 자료" : ""}
            </p>
          </div>
          <nav className="search-exports" aria-label="내보내기" aria-busy={exporting}>
            <span>내보내기</span>
            <a
              href={exportHref("csv")}
              aria-label="CSV 내보내기"
              aria-disabled={exporting}
              onClick={(event) => {
                event.preventDefault();
                void exportResults("csv");
              }}
            >
              CSV
            </a>
            <a
              href={exportHref("xlsx")}
              aria-label="Excel 내보내기"
              aria-disabled={exporting}
              onClick={(event) => {
                event.preventDefault();
                void exportResults("xlsx");
              }}
            >
              Excel
            </a>
          </nav>
        </div>
        {exportError ? (
          <p className="field-error" role="alert">
            {exportError}
          </p>
        ) : null}

        {result.data ? (
          <dl className="search-totals" aria-label="검색 합계">
            <div>
              <dt>수입</dt>
              <dd className="num" data-kind="income">
                {formatSigned("income", result.data.totals.income)}
              </dd>
            </div>
            <div>
              <dt>지출</dt>
              <dd className="num" data-kind="expense">
                {formatSigned("expense", result.data.totals.expense)}
              </dd>
            </div>
            <div>
              <dt>순합계</dt>
              <dd className="num">
                {result.data.totals.net < 0
                  ? `-${formatWon(-result.data.totals.net)}`
                  : `+${formatWon(result.data.totals.net)}`}
              </dd>
            </div>
          </dl>
        ) : null}

        {result.data === undefined && result.loading ? (
          <div className="search-skeletons" role="status" aria-label="검색 결과 불러오는 중">
            <Skeleton variant="rows" />
          </div>
        ) : result.data === undefined ? (
          <EmptyState
            tone="error"
            title="검색 결과를 불러오지 못했어요"
            action={
              <Button size="sm" onClick={result.reload}>
                다시 시도
              </Button>
            }
          />
        ) : transactions.length === 0 ? (
          <EmptyState
            icon={Search}
            title="검색 결과가 없어요"
            description="검색어나 필터를 바꿔 보세요."
            action={<Button onClick={resetFilters}>필터 초기화</Button>}
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
