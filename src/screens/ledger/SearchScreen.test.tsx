import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "fake-indexeddb/auto";
import { clearMemoryCache } from "../../api/hooks";
import { markNetwork, setCsrfToken } from "../../api/transport";
import { navigate } from "../../router";
import SearchScreen from "./SearchScreen";

const realFetch = globalThis.fetch;
const calls: string[] = [];
let foreign = false;
const shareProperties = ["standalone", "canShare", "share"] as const;
const originalShareProperties = shareProperties.map(
  (key) => [key, Object.getOwnPropertyDescriptor(navigator, key)] as const,
);

beforeEach(() => {
  calls.length = 0;
  foreign = false;
  navigate("/search", { replace: true });
  clearMemoryCache();
  markNetwork(true);
  setCsrfToken("search-test-session");
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/categories"))
        return Response.json({
          items: [{ id: "food", name: "식비", children: [{ id: "cafe", name: "카페", parent_id: "food" }] }],
        });
      if (url.includes("/assets")) return Response.json({ items: [] });
      return Response.json({
        items: [
          {
            id: "tx-sample",
            type: "expense",
            occurred_at: "2026-10-03T12:00:00+09:00",
            amount: foreign ? 0 : 3200,
            is_refund: false,
            currency: foreign ? "USD" : "KRW",
            foreign_amount: foreign ? 3.2 : null,
            krw_status: foreign ? "pending" : "exact",
            asset_id: null,
            to_asset_id: null,
            category_id: "cafe",
            merchant: foreign ? "" : "샘플카페",
            merchant_key: "샘플카페",
            memo: "점심",
            source: "manual",
            source_key: null,
            src_account: null,
            src_amount: null,
            src_at: null,
            hidden: false,
            hidden_reason: null,
            user_locked: [],
            recurring_rule_id: null,
            deleted_at: null,
            created_at: "2026-10-03T12:00:00+09:00",
            updated_at: "2026-10-03T12:00:00+09:00",
          },
        ],
        next_cursor: null,
        totals: { income: 0, expense: 3200, net: -3200, count: 1 },
      });
    },
    { preconnect: realFetch.preconnect },
  );
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  for (const [key, descriptor] of originalShareProperties) {
    if (descriptor) Object.defineProperty(navigator, key, descriptor);
    else Reflect.deleteProperty(navigator, key);
  }
});

describe("SearchScreen", () => {
  test("result rows show the parent and child category in front of the memo", async () => {
    render(<SearchScreen />);
    const row = await screen.findByRole("button", { name: /샘플카페/ });
    await waitFor(() => expect(row.querySelector(".list-row-subtitle")?.textContent).toBe("식비 › 카페 · 점심"));
  });

  for (const mode of ["share", "cancel", "download"] as const) {
    test(`filtered export uses the ${mode} file workflow`, async () => {
      const baseFetch = globalThis.fetch;
      const exported: URL[] = [];
      const shared: File[] = [];
      const downloads: { name: string; url: string }[] = [];
      const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push({ name: this.download, url: this.href });
      });
      Object.defineProperties(navigator, {
        standalone: { configurable: true, value: mode !== "download" },
        canShare: { configurable: true, value: () => true },
        share: {
          configurable: true,
          value: async (data: ShareData) => {
            shared.push(...(data.files ?? []));
            if (mode === "cancel") throw new DOMException("cancelled", "AbortError");
          },
        },
      });
      globalThis.fetch = Object.assign(
        async (input: RequestInfo | URL) => {
          const url = new URL(String(input), location.origin);
          if (!url.pathname.endsWith("/export")) return baseFetch(input);
          exported.push(url);
          return new Response("merchant,amount\n샘플카페,3200", {
            headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="filtered.csv"' },
          });
        },
        { preconnect: realFetch.preconnect },
      );
      try {
        navigate("/search?type=expense&category_id=cafe", { replace: true });
        await act(async () => {
          render(<SearchScreen />);
        });
        await act(async () => {
          fireEvent.click(screen.getByRole("link", { name: "CSV 내보내기" }));
        });
        expect(exported).toHaveLength(1);
        expect(exported[0]?.searchParams.get("category_id")).toBe("cafe");
        expect(exported[0]?.searchParams.get("type")).toBe("expense");
        if (mode === "download") {
          expect(shared).toHaveLength(0);
          expect(downloads.map((item) => item.name)).toEqual(["filtered.csv"]);
        } else {
          expect(shared[0]?.name).toBe("filtered.csv");
          expect(await shared[0]?.text()).toContain("샘플카페,3200");
          expect(downloads).toHaveLength(0);
        }
        expect(screen.queryByRole("alert") === null).toBe(true);
      } finally {
        click.mockRestore();
        for (const item of downloads) URL.revokeObjectURL(item.url);
      }
    });
  }

  test("loads the remaining results without losing filters or the first page", async () => {
    const baseFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const response = await baseFetch(input);
        const url = new URL(String(input), location.origin);
        if (!url.pathname.endsWith("/transactions")) return response;
        const data = await response.json();
        const later = url.searchParams.has("cursor");
        return Response.json({
          ...data,
          items: later ? [{ ...data.items[0], id: "tx-later", merchant: "다음페이지카페" }] : data.items,
          next_cursor: later ? null : "next-page",
          totals: { income: 0, expense: 6400, net: -6400, count: 2 },
        });
      },
      { preconnect: realFetch.preconnect },
    );
    navigate("/search?type=expense&category_id=cafe", { replace: true });
    render(<SearchScreen />);
    await screen.findByRole("button", { name: /샘플카페/ });
    fireEvent.click(await screen.findByRole("button", { name: "거래 더 보기" }));
    expect(await screen.findByRole("button", { name: /다음페이지카페/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /샘플카페/ })).toBeTruthy();
    const pageRequest = calls.map((url) => new URL(url, location.origin)).find((url) => url.searchParams.has("cursor"));
    expect(pageRequest?.searchParams.get("cursor")).toBe("next-page");
    expect(pageRequest?.searchParams.get("category_id")).toBe("cafe");
    expect(pageRequest?.searchParams.get("type")).toBe("expense");
    expect(screen.queryByRole("button", { name: "거래 더 보기" }) === null).toBe(true);
  });

  test("uncategorized URL persists through requests exports chips and filter application", async () => {
    navigate("/search?category_id=uncategorized&type=expense", { replace: true });
    await act(async () => {
      render(<SearchScreen />);
    });
    expect(calls.some((url) => url.includes("category_id=uncategorized"))).toBe(true);
    for (const name of ["CSV 내보내기", "Excel 내보내기"]) {
      expect(screen.getByRole("link", { name }).getAttribute("href")).toContain("category_id=uncategorized");
    }
    expect(screen.getByLabelText("적용된 필터").textContent).toContain("미분류");
    fireEvent.click(screen.getByRole("button", { name: /필터, / }));
    expect(screen.getByRole("checkbox", { name: "미분류" }).getAttribute("checked")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    expect(new URLSearchParams(location.search).get("category_id")).toBe("uncategorized");
  });

  test("initial URL filters reach the request and both export links", async () => {
    const params = new URLSearchParams({
      q: "샘플",
      from: "2026-10-01",
      to: "2026-10-31",
      type: "expense",
      category_id: "cafe",
      asset_id: "bank",
      min: "0",
      max: "5000",
      source: "manual",
      hidden: "include",
    });
    navigate(`/search?${params}`, { replace: true });
    await act(async () => {
      render(<SearchScreen />);
    });
    expect(screen.getByRole("searchbox").getAttribute("value")).toBe("샘플");
    const request = calls.find((url) => url.includes("/transactions"));
    const actual = new URL(request ?? "", location.origin).searchParams;
    for (const [key, value] of params) expect(actual.get(key)).toBe(value);
    for (const name of ["CSV 내보내기", "Excel 내보내기"]) {
      const href = screen.getByRole("link", { name }).getAttribute("href") ?? "";
      const exported = new URL(href, location.origin).searchParams;
      for (const [key, value] of params) expect(exported.get(key)).toBe(value);
    }
    expect(screen.getByLabelText("적용된 필터").textContent).toContain("카페");
  });

  test("same-screen navigation and popstate restore filters without remounting", async () => {
    await act(async () => {
      render(<SearchScreen />);
    });
    await act(async () => {
      navigate("/search?type=income&hidden=only&q=급여");
    });
    expect(screen.getByRole("searchbox").getAttribute("value")).toBe("급여");
    expect(screen.getByRole("link", { name: "CSV 내보내기" }).getAttribute("href")).toContain("type=income");
    await act(async () => {
      history.replaceState(null, "", "/search?category_id=cafe&type=expense");
      window.dispatchEvent(new Event("popstate"));
    });
    expect(screen.getByRole("searchbox").getAttribute("value")).toBe("");
    expect(screen.getByLabelText("적용된 필터").textContent).toContain("카페");
  });

  test("clearing filters preserves the search term in the URL", async () => {
    navigate("/search?q=샘플&type=expense&category_id=cafe", { replace: true });
    await act(async () => {
      render(<SearchScreen />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "필터 모두 해제" }));
    });
    expect(new URLSearchParams(location.search).get("q")).toBe("샘플");
    expect(new URLSearchParams(location.search).has("category_id")).toBe(false);
    expect(new URLSearchParams(location.search).has("type")).toBe(false);
  });

  test("nested category labels and pending foreign amounts match daily rows", async () => {
    foreign = true;
    await act(async () => {
      render(<SearchScreen />);
    });
    const row = screen.getByRole("button", { name: /카페.*USD 3.2/ });
    expect(row.textContent).not.toContain("0원");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "필터" }));
    });
    expect(screen.getByLabelText("카페")).toBeTruthy();
  });

  test("selecting another category replaces rather than combines categories", async () => {
    await act(async () => {
      render(<SearchScreen />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "필터" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("식비"));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("카페"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "적용" }));
    });
    expect(new URLSearchParams(location.search).get("category_id")).toBe("cafe");
    expect(calls.some((url) => url.includes("category_id=cafe"))).toBe(true);
  });
  test("searches after debounce and displays matching results and totals", async () => {
    render(<SearchScreen />);
    const input = screen.getByRole("searchbox", { name: "검색어" });
    fireEvent.change(input, { target: { value: "샘플" } });

    await waitFor(() => {
      expect(calls.some((url) => url.includes("q=%EC%83%98%ED%94%8C"))).toBe(true);
    });
    expect(await screen.findByText("샘플카페")).toBeTruthy();
    expect(screen.getByRole("button", { name: /샘플카페.*3,200원/ })).toBeTruthy();
    expect(screen.getByLabelText("검색 합계").textContent).toContain("-3,200원");
    expect(screen.getByRole("link", { name: "CSV 내보내기" }).getAttribute("href")).toContain("q=%EC%83%98%ED%94%8C");
  });

  test("min greater than max reports an error without requesting results", async () => {
    render(<SearchScreen />);
    await screen.findByRole("button", { name: "필터" });
    fireEvent.click(screen.getByRole("button", { name: "필터" }));
    fireEvent.change(screen.getByLabelText("최소 금액"), { target: { value: "9000" } });
    fireEvent.change(screen.getByLabelText("최대 금액"), { target: { value: "1000" } });
    const transactionCalls = calls.filter((url) => url.includes("/transactions")).length;

    fireEvent.click(screen.getByRole("button", { name: "적용" }));

    expect(await screen.findByText("최소 금액은 최대 금액보다 클 수 없어요")).toBeTruthy();
    await act(async () => Promise.resolve());
    expect(calls.filter((url) => url.includes("/transactions"))).toHaveLength(transactionCalls);
  });

  test("hidden-only selection sends the supported hidden=only query", async () => {
    render(<SearchScreen />);
    await screen.findByRole("button", { name: "필터" });
    fireEvent.click(screen.getByRole("button", { name: "필터" }));
    fireEvent.click(screen.getByRole("button", { name: "숨김만" }));
    fireEvent.click(screen.getByRole("button", { name: "적용" }));

    await waitFor(() => {
      expect(calls.some((url) => url.includes("hidden=only"))).toBe(true);
    });
  });
});
