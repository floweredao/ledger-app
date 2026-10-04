import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "fake-indexeddb/auto";
import { clearCache } from "../../api/cache";
import { clearMemoryCache, useApi } from "../../api/hooks";
import { markNetwork, setCsrfToken } from "../../api/transport";
import { dismissToast, ToastRegion, toast } from "../../components/Toast";
import DataScreen from "./DataScreen";

const realFetch = globalThis.fetch;
const shareProperties = ["standalone", "canShare", "share"] as const;
const originalShareProperties = shareProperties.map(
  (key) => [key, Object.getOwnPropertyDescriptor(navigator, key)] as const,
);
const previewId = "0199aaaa-0000-7000-8000-000000000001";
const result = { inserted: 5, merged: 2, skipped: 3, hidden: 1, errors: [] };
const status = {
  last_run_at: "2024-01-15T09:30:00+09:00",
  last_result: result,
  last_error: null,
  next_run_at: null,
};
const row = {
  row: 2,
  type: "expense",
  occurred_at: "2024-01-15T09:30:00+09:00",
  amount: 4500,
  merchant: "샘플카페",
  memo: "샘플 메모",
  currency: "KRW",
  foreign_amount: null,
  krw_status: "exact",
  is_refund: false,
  asset_id: null,
  to_asset_id: null,
  category_id: null,
  asset_name: "테스트지갑",
  to_asset_name: "",
  category_name: "식비",
  subcategory_name: "간식",
  hidden: false,
  duplicate: true,
};
const preview = {
  preview_id: previewId,
  detected_format: "ledger",
  rows: [row],
  counts: { total: 1, new: 0, duplicate: 1, error: 0 },
  errors: [],
};
let calls: { url: string; init: RequestInit }[] = [];
let respond: (url: string, init: RequestInit) => Response | Promise<Response>;
let clicks: string[] = [];
let downloads: Blob[] = [];
let restoreResponse: Response;
let previewResponse: Response;
let syncResponse: Response;
let clickSpy: ReturnType<typeof spyOn>;
let urlSpy: ReturnType<typeof spyOn>;
const json = (value: unknown, code = 200) => Response.json(value, { status: code });
function clearToasts() {
  const lastId = toast({ message: "테스트 정리" });
  for (let id = 1; id <= lastId; id++) dismissToast(id);
}

/** Subscribe before the action. No polling or fixed sleeps. */
function changed(predicate: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(check);
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`DOM state was not reached: ${document.body.textContent}`));
    }, 2000);
    function check() {
      if (!predicate()) return;
      clearTimeout(timeout);
      observer.disconnect();
      resolve();
    }
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    check();
  });
}
async function mount() {
  const ready = changed(() => screen.queryByText("마지막 동기화") !== null);
  await act(async () => {
    render(
      <>
        <DataScreen />
        <ToastRegion />
      </>,
    );
  });
  await ready;
}
async function upload(file = new File(["sample"], "sample.csv", { type: "text/csv" })) {
  const done = changed(
    () => screen.queryByText("미리보기", { exact: false }) !== null && screen.queryByText("미리보기 중...") === null,
  );
  await act(async () => {
    fireEvent.change(screen.getByLabelText("파일 선택"), { target: { files: [file] } });
  });
  await done;
}
function restoreFile(file = new File(['{"version":1}'], "backup.json", { type: "application/json" })) {
  fireEvent.change(screen.getByLabelText("백업 파일"), { target: { files: [file] } });
}
function confirmRestore() {
  fireEvent.change(screen.getByLabelText("복원 확인 텍스트 입력"), { target: { value: "복원" } });
}
async function clickButton(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}
function request(suffix: string) {
  const call = calls.find((c) => c.url.includes(suffix));
  if (!call) throw new Error(`Missing request: ${suffix}`);
  return call;
}

beforeEach(async () => {
  calls = [];
  clicks = [];
  downloads = [];
  clearToasts();
  clearMemoryCache();
  await clearCache();
  markNetwork(true);
  setCsrfToken("synthetic-csrf");
  previewResponse = json(preview);
  restoreResponse = json({ ok: true });
  syncResponse = json(result);
  respond = (url) => {
    if (url.endsWith("sync/status")) return json(status);
    if (url.endsWith("import/preview")) return previewResponse;
    if (url.endsWith("import/commit")) return json({ inserted: 0, skipped: 1 });
    if (url.includes("backup/restore")) return restoreResponse;
    if (url.endsWith("sync/run")) return syncResponse;
    if (url.endsWith("backup")) return json({ version: 1, transactions: [] });
    if (url.includes("export?")) {
      const xlsx = url.includes("format=xlsx");
      return new Response("sample", {
        headers: {
          "Content-Type": xlsx
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="ledger-20240115.${xlsx ? "xlsx" : "csv"}"`,
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: String(input), init });
      return respond(String(input), init);
    },
    { preconnect: realFetch.preconnect },
  );
  clickSpy = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push(this.download);
  });
  urlSpy = spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    if (blob instanceof Blob) downloads.push(blob);
    return "blob:synthetic";
  });
});
afterEach(async () => {
  cleanup();
  clearToasts();
  globalThis.fetch = realFetch;
  clickSpy.mockRestore();
  urlSpy.mockRestore();
  clearMemoryCache();
  await clearCache();
  setCsrfToken(null);
  markNetwork(true);
  for (const [key, descriptor] of originalShareProperties) {
    if (descriptor) Object.defineProperty(navigator, key, descriptor);
    else Reflect.deleteProperty(navigator, key);
  }
});

describe("export section", () => {
  test("renders export heading and both format buttons", async () => {
    await mount();
    expect(screen.getByRole("heading", { name: "내보내기" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "CSV 다운로드" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "XLSX 다운로드" })).toBeTruthy();
  });
  test("shows month, year and custom presets", async () => {
    await mount();
    expect(
      within(screen.getByLabelText("기간"))
        .getAllByRole("option")
        .map((o) => o.getAttribute("value")),
    ).toEqual(["month", "year", "custom"]);
  });
  test.each(["csv", "xlsx"] as const)("downloads %s with the server MIME and filename", async (format) => {
    await mount();
    const done = changed(() => clicks.length === 1);
    await clickButton(`${format.toUpperCase()} 다운로드`);
    await done;
    expect(clicks).toEqual([`ledger-20240115.${format}`]);
    expect(downloads[0]?.type).toBe(
      format === "csv"
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });
  test.each(["month", "year"] as const)("exports inclusive KST %s dates at a UTC year boundary", async (period) => {
    const now = spyOn(Date, "now").mockReturnValue(Date.parse("2024-12-31T16:00:00Z"));
    try {
      await mount();
      fireEvent.change(screen.getByLabelText("기간"), { target: { value: period } });
      const done = changed(() => clicks.length === 1);
      await clickButton("CSV 다운로드");
      await done;
      const params = new URL(request("export?").url, "http://test").searchParams;
      expect(Object.fromEntries(params)).toEqual({
        format: "csv",
        from: "2025-01-01",
        to: period === "month" ? "2025-01-31" : "2025-12-31",
      });
    } finally {
      now.mockRestore();
    }
  });
  test("requires a complete ordered custom date range", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("기간"), { target: { value: "custom" } });
    expect(screen.getByRole("button", { name: "CSV 다운로드" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2024-02-29" } });
    fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2024-02-28" } });
    expect(screen.getByRole("button", { name: "CSV 다운로드" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2024-02-29" } });
    const done = changed(() => clicks.length === 1);
    await clickButton("CSV 다운로드");
    await done;
    expect(request("export?").url).toBe("/api/v1/export?format=csv&from=2024-02-29&to=2024-02-29");
  });
});

describe("import section", () => {
  test("previews valid transfers before new asset names have resolved IDs", async () => {
    previewResponse = json({
      ...preview,
      rows: [
        { ...row, type: "transfer", asset_name: "새 테스트계좌", to_asset_name: "새 테스트지갑", duplicate: false },
      ],
      counts: { total: 1, new: 1, duplicate: 0, error: 0 },
    });
    await mount();
    await upload();
    expect(screen.getByText("새 테스트계좌 · → 새 테스트지갑 · 식비 · 간식")).toBeTruthy();
    expect(screen.getByText(/이체 · 4,500원/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "확인" }).hasAttribute("disabled")).toBe(false);
  });
  test("renders the file input and supported extensions", async () => {
    await mount();
    const input = screen.getByLabelText("파일 선택");
    expect(input.getAttribute("type")).toBe("file");
    expect(input.getAttribute("accept")).toBe(".csv,.xlsx");
  });
  test("shows preview loading until the multipart transport resolves", async () => {
    await mount();
    const pending = Promise.withResolvers<Response>();
    const original = respond;
    respond = (url, init) => (url.endsWith("import/preview") ? pending.promise : original(url, init));
    fireEvent.change(screen.getByLabelText("파일 선택"), { target: { files: [new File(["a"], "sample.csv")] } });
    expect(screen.getByText("미리보기 중...")).toBeTruthy();
    const done = changed(() => screen.queryByText("미리보기 중...") === null);
    await act(async () => {
      pending.resolve(json(preview));
      await pending.promise;
    });
    await done;
    expect(request("import/preview").init.body).toBeInstanceOf(FormData);
    expect(new Headers(request("import/preview").init.headers).get("Content-Type")).toBeNull();
  });
  test("uses nested total/new/duplicate/error counts instead of truncated rows", async () => {
    previewResponse = json({
      ...preview,
      rows: Array.from({ length: 50 }, (_, index) => ({
        ...row,
        row: index + 2,
        merchant: index === 0 ? row.merchant : `테스트마트 ${index}`,
        duplicate: index < 2,
      })),
      counts: { total: 60, new: 58, duplicate: 2, error: 0 },
    });
    await mount();
    await upload();
    const counts = document.querySelector(".preview-counts");
    expect(counts?.textContent).toContain("60");
    expect(counts?.textContent).toContain("58");
    expect(counts?.textContent).toContain("2");
    expect(document.querySelectorAll(".preview-rows li").length).toBe(50);
    const firstRow = document.querySelector(".preview-rows li");
    if (!(firstRow instanceof HTMLElement)) throw new Error("Missing preview details");
    expect(within(firstRow).getByText("샘플카페")).toBeTruthy();
    expect(within(firstRow).getByText(/테스트지갑/)).toBeTruthy();
    expect(within(firstRow).getByText(/간식/)).toBeTruthy();
    expect(within(firstRow).getByText(/샘플 메모/)).toBeTruthy();
  });
  test("preserves row errors and permits committing valid rows", async () => {
    previewResponse = json({
      ...preview,
      rows: [{ ...row, duplicate: false }],
      counts: { total: 3, new: 1, duplicate: 0, error: 2 },
      errors: [
        { row: 3, message: "필수 필드 금액이 없어요" },
        { row: 4, message: "날짜 형식이 잘못됐어요" },
      ],
    });
    await mount();
    await upload();
    expect(screen.getByText("필수 필드 금액이 없어요")).toBeTruthy();
    expect(screen.getByText("날짜 형식이 잘못됐어요")).toBeTruthy();
    expect(screen.getByRole("button", { name: "확인" }).hasAttribute("disabled")).toBe(false);
  });
  test("commits with preview_id, excludes duplicates and displays skipped rows", async () => {
    await mount();
    await upload();
    const done = changed(() => screen.queryByText("0개 추가됨 · 1개 건너뜀") !== null);
    await clickButton("확인");
    await done;
    expect(JSON.parse(String(request("import/commit").init.body))).toEqual({
      preview_id: previewId,
      include_duplicates: false,
    });
    expect(new Headers(request("import/commit").init.headers).get("X-CSRF-Token")).toBe("synthetic-csrf");
  });
  test("sends include_duplicates true only when selected", async () => {
    await mount();
    await upload();
    fireEvent.click(screen.getByLabelText("중복도 포함하기"));
    const done = changed(() => document.querySelector(".data-preview") === null);
    await clickButton("확인");
    await done;
    expect(JSON.parse(String(request("import/commit").init.body)).include_duplicates).toBe(true);
  });
  test("commits a new valid row and reports the inserted count", async () => {
    previewResponse = json({
      ...preview,
      rows: [{ ...row, duplicate: false }],
      counts: { total: 1, new: 1, duplicate: 0, error: 0 },
    });
    const original = respond;
    respond = (url, init) => (url.endsWith("import/commit") ? json({ inserted: 1, skipped: 0 }) : original(url, init));
    await mount();
    await upload();
    const done = changed(() => screen.queryByText("1개 추가됨 · 0개 건너뜀") !== null);
    await clickButton("확인");
    await done;
    expect(document.querySelector(".data-preview")).toBeNull();
  });
  test("clears the actual file control and preview after commit", async () => {
    await mount();
    await upload();
    const before = screen.getByLabelText("파일 선택");
    const done = changed(() => document.querySelector(".data-preview") === null);
    await clickButton("확인");
    await done;
    expect(screen.getByLabelText("파일 선택") === before).toBe(false);
    expect(screen.getByLabelText("파일 선택").getAttribute("value") ?? "").toBe("");
  });
  test("shows rejected upload errors without a commit control", async () => {
    previewResponse = json({ error: { code: "invalid_csv", message: "Unterminated quoted field" } }, 400);
    await mount();
    const done = changed(() => screen.queryByText("Unterminated quoted field") !== null);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("파일 선택"), { target: { files: [new File(['"bad'], "sample.csv")] } });
    });
    await done;
    expect(screen.queryByRole("button", { name: "확인" })).toBeNull();
  });
});

describe("backup and restore sections", () => {
  test("shares the JSON backup with its .json filename in an installed PWA", async () => {
    const shared: File[] = [];
    Object.defineProperties(navigator, {
      standalone: { configurable: true, value: true },
      canShare: { configurable: true, value: () => true },
      share: {
        configurable: true,
        value: async (data: ShareData) => {
          for (const file of data.files ?? []) shared.push(file);
        },
      },
    });
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "백업 다운로드" }));
    });
    expect(shared[0]?.name).toMatch(/^ledger-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(shared[0]?.type).toBe("application/json;charset=utf-8");
    expect(JSON.parse((await shared[0]?.text()) ?? "{}")).toEqual({ version: 1, transactions: [] });
    expect(clicks).toEqual([]);
  });
  test("does not download a second file when the share sheet is cancelled", async () => {
    Object.defineProperties(navigator, {
      standalone: { configurable: true, value: true },
      canShare: { configurable: true, value: () => true },
      share: {
        configurable: true,
        value: async () => {
          throw new DOMException("cancelled", "AbortError");
        },
      },
    });
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "백업 다운로드" }));
    });
    expect(clicks).toEqual([]);
    expect(screen.queryByText(/백업 다운로드 실패/)).toBeNull();
  });
  test("reports a missing backup MIME instead of saving an assumed JSON file", async () => {
    const original = respond;
    respond = (url, init) =>
      url.endsWith("/backup") ? new Response("{}", { headers: { "Content-Type": "" } }) : original(url, init);
    await mount();
    const done = changed(() => screen.queryByText(/백업 응답이 JSON 파일이 아니에요/) !== null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "백업 다운로드" }));
    });
    await done;
    expect(clicks).toEqual([]);
  });
  test("renders backup heading and download button", async () => {
    await mount();
    expect(screen.getByRole("heading", { name: "백업" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "백업 다운로드" })).toBeTruthy();
  });
  test("supplies a JSON backup filename when the actual route has no disposition", async () => {
    await mount();
    const done = changed(() => clicks.length === 1);
    await clickButton("백업 다운로드");
    await done;
    expect(request("/backup").init.method).toBe("GET");
    expect(clicks[0]).toMatch(/^ledger-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(downloads[0]?.type).toBe("application/json;charset=utf-8");
  });
  test("renders restore heading and requires a JSON file", async () => {
    await mount();
    expect(screen.getByRole("heading", { name: "복원" })).toBeTruthy();
    expect(screen.getByLabelText("백업 파일").getAttribute("accept")).toBe(".json");
    expect(screen.getByRole("button", { name: "복원" }).hasAttribute("disabled")).toBe(true);
  });
  test("requires the exact typed confirmation in addition to a file", async () => {
    await mount();
    restoreFile();
    const button = screen.getByRole("button", { name: "복원" });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("복원 확인 텍스트 입력"), { target: { value: "복원 " } });
    expect(button.hasAttribute("disabled")).toBe(true);
    confirmRestore();
    expect(button.hasAttribute("disabled")).toBe(false);
  });
  test("restores JSON through confirm=REPLACE with CSRF", async () => {
    await mount();
    restoreFile();
    confirmRestore();
    const done = changed(() => screen.queryByText("복원 완료") !== null);
    await clickButton("복원");
    await done;
    const call = request("backup/restore");
    expect(call.url).toBe("/api/v1/backup/restore?confirm=REPLACE");
    expect(call.init.body).toBe('{"version":1}');
    expect(new Headers(call.init.headers).get("Content-Type")).toBe("application/json");
    expect(new Headers(call.init.headers).get("X-CSRF-Token")).toBe("synthetic-csrf");
  });
  test("clears the file and confirmation and disables restore after success", async () => {
    await mount();
    restoreFile();
    confirmRestore();
    const before = screen.getByLabelText("백업 파일");
    const done = changed(() => screen.queryByLabelText("복원 확인 텍스트 입력") === null);
    await clickButton("복원");
    await done;
    expect(screen.getByLabelText("백업 파일") === before).toBe(false);
    expect(screen.getByRole("button", { name: "복원" }).hasAttribute("disabled")).toBe(true);
  });
  test("preserves file and confirmation on schema rejection without a success toast", async () => {
    restoreResponse = json({ error: { code: "invalid_request", message: "Invalid backup schema" } }, 400);
    await mount();
    restoreFile();
    confirmRestore();
    const before = screen.getByLabelText("백업 파일");
    const done = changed(() => screen.queryByText("Invalid backup schema") !== null);
    await clickButton("복원");
    await done;
    expect(screen.getByLabelText("백업 파일") === before).toBe(true);
    expect(screen.getByLabelText("복원 확인 텍스트 입력").getAttribute("value")).toBe("복원");
    expect(screen.queryByText("복원 완료")).toBeNull();
  });
  test("requires renewed confirmation when the restore file changes", async () => {
    await mount();
    restoreFile();
    confirmRestore();
    restoreFile(new File(["{}"], "other.json"));
    expect(screen.getByRole("button", { name: "복원" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("sync section and shared hooks", () => {
  test("renders sync heading and real fetched status", async () => {
    await mount();
    expect(screen.getByRole("heading", { name: "동기화" })).toBeTruthy();
    expect(request("sync/status").init.credentials).toBe("same-origin");
  });
  test("displays the last run as a compact previous-year KST date", async () => {
    await mount();
    expect(document.querySelector(".sync-status")?.textContent).toContain("2024년 1월 15일");
  });
  test("displays inserted, merged, skipped and hidden counts", async () => {
    await mount();
    const items = Array.from(document.querySelectorAll(".status-item")).map((el) => el.textContent);
    expect(items).toContain("추가됨5");
    expect(items).toContain("통합됨2");
    expect(items).toContain("건너뜀3");
    expect(items).toContain("숨김1");
  });
  test("renders the enabled manual sync button after status loads", async () => {
    await mount();
    expect(screen.getByRole("button", { name: "지금 동기화" }).hasAttribute("disabled")).toBe(false);
  });
  test("runs sync, reloads status and invalidates transaction subscribers", async () => {
    function Probe() {
      const state = useApi<{ count: number }>("transactions");
      return <output>{state.data?.count}</output>;
    }
    let count = 0;
    const original = respond;
    respond = (url, init) => (url.endsWith("/transactions") ? json({ count: ++count }) : original(url, init));
    await mount();
    const loaded = changed(() => document.querySelector("output")?.textContent === "1");
    await act(async () => {
      render(<Probe />);
    });
    await loaded;
    const done = changed(() => document.querySelector("output")?.textContent === "2");
    await clickButton("지금 동기화");
    await done;
    expect(request("sync/run").init.method).toBe("POST");
    expect(calls.filter((c) => c.url.endsWith("sync/status")).length).toBe(2);
  });
  test("reports HTTP sync failures", async () => {
    syncResponse = json({ error: { code: "not_available", message: "Importer not configured" } }, 503);
    await mount();
    const done = changed(() => screen.queryByText("Importer not configured") !== null);
    await clickButton("지금 동기화");
    await done;
    expect(screen.queryByText(/^동기화 완료/)).toBeNull();
  });
  test("reports import_failed in an HTTP 200 result without success", async () => {
    syncResponse = json({ inserted: 0, merged: 0, skipped: 0, hidden: 0, errors: ["import_failed"] });
    await mount();
    const done = changed(() => screen.queryByText("동기화 오류: import_failed") !== null);
    await clickButton("지금 동기화");
    await done;
    expect(screen.queryByText(/^동기화 완료/)).toBeNull();
  });
  test("disables manual sync until its response resolves", async () => {
    await mount();
    const pending = Promise.withResolvers<Response>();
    const original = respond;
    respond = (url, init) => (url.endsWith("sync/run") ? pending.promise : original(url, init));
    await clickButton("지금 동기화");
    expect(screen.getByRole("button", { name: "동기화 중..." }).hasAttribute("disabled")).toBe(true);
    const done = changed(() => screen.queryByRole("button", { name: "지금 동기화" }) !== null);
    await act(async () => {
      pending.resolve(json(result));
      await pending.promise;
    });
    await done;
  });
  test("shows status loading before the shared hook response", async () => {
    const pending = Promise.withResolvers<Response>();
    respond = () => pending.promise;
    render(<DataScreen />);
    expect(screen.getByText("상태 조회 중...")).toBeTruthy();
    await act(async () => {
      pending.resolve(json(status));
      await pending.promise;
    });
  });
  test("uses cached status and reports offline after a network failure", async () => {
    await mount();
    cleanup();
    respond = () => {
      throw new TypeError("synthetic offline");
    };
    const done = changed(() => screen.queryByText(/오프라인 상태/) !== null);
    await act(async () => {
      render(<DataScreen />);
    });
    await done;
    expect(screen.getByText("마지막 동기화")).toBeTruthy();
  });
  test("reports rejected status requests instead of fabricated status", async () => {
    respond = () => json({ error: { code: "internal_error", message: "Status fetch failed" } }, 500);
    const done = changed(() => screen.queryByText(/상태 조회 실패/) !== null);
    await act(async () => {
      render(<DataScreen />);
    });
    await done;
    expect(screen.queryByText("마지막 동기화")).toBeNull();
  });
});

describe("layout and accessibility", () => {
  test("groups all five workflows in named sections", async () => {
    await mount();
    expect(screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"))).toEqual([
      "내보내기",
      "가져오기",
      "백업",
      "복원",
      "동기화",
    ]);
  });
  test("has one screen heading and five workflow headings", async () => {
    await mount();
    expect(screen.getAllByRole("heading", { level: 1 }).length).toBe(1);
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBe(5);
  });
  test("labels both real file inputs without vacuous button searches", async () => {
    await mount();
    expect(screen.getByLabelText("파일 선택").getAttribute("type")).toBe("file");
    expect(screen.getByLabelText("백업 파일").getAttribute("type")).toBe("file");
  });
});
