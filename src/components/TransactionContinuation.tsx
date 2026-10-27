import { type ReactNode, useState } from "react";
import type { Transaction, TransactionList } from "../../shared/schema";
import { paths } from "../api/client";
import { useApi } from "../api/hooks";
import { useMessages } from "../i18n";
import { common } from "../i18n/common";
import { Button } from "./Button";
import { Skeleton } from "./Skeleton";
import { componentMessages } from "./ui-messages";

type Props = {
  readonly query: Parameters<typeof paths.transactions>[0];
  readonly cursor: string | null;
  readonly seenIds: readonly string[];
  readonly renderRows: (items: readonly Transaction[]) => ReactNode;
};

/** Each loaded page keeps its own cache subscription and cursor. */
export function TransactionContinuation({ query, cursor, seenIds, renderRows }: Props) {
  const m = useMessages(componentMessages);
  const c = useMessages(common);
  const [requested, setRequested] = useState(false);
  const page = useApi<TransactionList>(requested && cursor ? paths.transactions({ ...query, cursor }) : null);
  if (!cursor) return null;
  if (!requested) {
    return (
      <Button block onClick={() => setRequested(true)}>
        {m.moreTransactions}
      </Button>
    );
  }
  if (!page.data) {
    return page.error ? (
      <div role="alert">
        <p>{m.loadMoreFailed}</p>
        <Button onClick={page.reload}>{c.retry}</Button>
      </div>
    ) : (
      <Skeleton label={m.loadingMore} />
    );
  }
  const seen = new Set(seenIds);
  const items = page.data.items.filter((item) => !seen.has(item.id));
  return (
    <>
      {renderRows(items)}
      <TransactionContinuation
        key={page.data.next_cursor ?? "end"}
        query={query}
        cursor={page.data.next_cursor}
        seenIds={[...seenIds, ...items.map((item) => item.id)]}
        renderRows={renderRows}
      />
    </>
  );
}
