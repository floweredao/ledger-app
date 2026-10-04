import { type ReactNode, useState } from "react";
import type { Transaction, TransactionList } from "../../shared/schema";
import { paths } from "../api/client";
import { useApi } from "../api/hooks";
import { Button } from "./Button";
import { Skeleton } from "./Skeleton";

type Props = {
  readonly query: Parameters<typeof paths.transactions>[0];
  readonly cursor: string | null;
  readonly seenIds: readonly string[];
  readonly renderRows: (items: readonly Transaction[]) => ReactNode;
};

/** Each loaded page keeps its own cache subscription and cursor. */
export function TransactionContinuation({ query, cursor, seenIds, renderRows }: Props) {
  const [requested, setRequested] = useState(false);
  const page = useApi<TransactionList>(requested && cursor ? paths.transactions({ ...query, cursor }) : null);
  if (!cursor) return null;
  if (!requested) {
    return (
      <Button block onClick={() => setRequested(true)}>
        거래 더 보기
      </Button>
    );
  }
  if (!page.data) {
    return page.error ? (
      <div role="alert">
        <p>나머지 거래를 불러오지 못했어요</p>
        <Button onClick={page.reload}>다시 시도</Button>
      </div>
    ) : (
      <Skeleton label="추가 거래 불러오는 중" />
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
