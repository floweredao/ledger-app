import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BudgetStatus } from "../../../shared/schema";
import { clearMemoryCache } from "../../api/hooks";
import BudgetView from "./BudgetView";

const realFetch = globalThis.fetch;
const calls: { readonly method: string; readonly url: string; readonly body: string }[] = [];
let savedTotal: number | null = null;

const status: BudgetStatus = {
  month: "2026-10",
  range: { from: "2026-10-01", to: "2026-10-31" },
  total: {
    budget_id: null,
    budget_month: null,
    budget: null,
    spent: 0,
    remaining: null,
    pct: null,
    over: false,
  },
  categories: [
    {
      category_id: "food",
      budget_id: "budget-food-default",
      budget_month: "",
      name: "식비",
      icon: "utensils",
      color: "cat-2",
      budget: 40_000,
      spent: 50_000,
      remaining: -10_000,
      pct: 125,
      over: true,
    },
  ],
};

let currentStatus: BudgetStatus = status;

beforeEach(() => {
  calls.length = 0;
  savedTotal = null;
  currentStatus = status;
  history.replaceState(null, "", "/budget?month=2026-10");
  clearMemoryCache();
  globalThis.fetch = Object.assign(
    async (...args: Parameters<typeof fetch>) => {
      const [input, init] = args;
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? init.body : "";
      calls.push({ method, url, body });
      if (method === "PUT") savedTotal = 100_000;
      if (method === "DELETE") savedTotal = null;
      if (method === "DELETE" && url.endsWith("/budget-food-month")) {
        currentStatus = {
          ...currentStatus,
          categories: currentStatus.categories.map((item) =>
            item.category_id === "food"
              ? {
                  ...item,
                  budget_id: "budget-food-default",
                  budget_month: "",
                  budget: 40_000,
                  remaining: -10_000,
                  pct: 125,
                  over: true,
                }
              : item,
          ),
        };
      }
      const payload =
        method === "GET"
          ? savedTotal === null
            ? currentStatus
            : {
                ...currentStatus,
                total: {
                  budget_id: "budget-1",
                  budget_month: "",
                  budget: savedTotal,
                  spent: 0,
                  remaining: savedTotal,
                  pct: 0,
                  over: false,
                },
              }
          : method === "DELETE"
            ? { ok: true }
            : { id: "budget-1", category_id: "", month: "", amount: 100_000 };
      return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
    },
    { preconnect: realFetch.preconnect },
  );
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

describe("BudgetEditor", () => {
  test("shows inline errors for negative and empty amounts", async () => {
    render(<BudgetView />);
    fireEvent.click(await screen.findByRole("button", { name: "총 예산 설정" }));

    const amount = screen.getByLabelText("금액");
    fireEvent.change(amount, { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("0원보다 큰 금액을 입력해 주세요")).toBeTruthy();

    fireEvent.change(amount, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("금액을 입력해 주세요")).toBeTruthy();
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(0);
  });

  test("saves the default total without a month override", async () => {
    render(<BudgetView />);
    fireEvent.click(await screen.findByRole("button", { name: "총 예산 설정" }));
    fireEvent.change(screen.getByLabelText("금액"), { target: { value: "100000" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    const request = calls.find((call) => call.method === "PUT");
    expect(request?.url).toBe("/api/v1/budgets");
    expect(JSON.parse(request?.body ?? "{}")).toEqual({ amount: 100_000 });
  });

  test("saves the total for only the selected month", async () => {
    render(<BudgetView />);
    fireEvent.click(await screen.findByRole("button", { name: "총 예산 설정" }));
    fireEvent.change(screen.getByLabelText("금액"), { target: { value: "100000" } });
    fireEvent.click(screen.getByRole("radio", { name: "이번 달만" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    const request = calls.find((call) => call.method === "PUT");
    expect(JSON.parse(request?.body ?? "{}")).toEqual({ amount: 100_000, month: "2026-10" });
  });

  test("saves the selected category default with its category id", async () => {
    render(<BudgetView />);
    fireEvent.click(await screen.findByRole("button", { name: "식비 예산 수정" }));
    fireEvent.change(screen.getByLabelText("금액"), { target: { value: "60000" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    const request = calls.find((call) => call.method === "PUT");
    expect(JSON.parse(request?.body ?? "{}")).toEqual({ amount: 60_000, category_id: "food" });
  });

  test("saves a category override for only the selected month", async () => {
    render(<BudgetView />);
    fireEvent.click(await screen.findByRole("button", { name: "식비 예산 수정" }));
    fireEvent.change(screen.getByLabelText("금액"), { target: { value: "60000" } });
    fireEvent.click(screen.getByRole("radio", { name: "이번 달만" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    const request = calls.find((call) => call.method === "PUT");
    expect(JSON.parse(request?.body ?? "{}")).toEqual({
      amount: 60_000,
      category_id: "food",
      month: "2026-10",
    });
  });

  test("deletes a default category budget using its reloaded id", async () => {
    render(<BudgetView />);
    fireEvent.click(await screen.findByRole("button", { name: "식비 예산 수정" }));

    const deleteButton = screen.getByRole("button", { name: "삭제" });
    expect(deleteButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(deleteButton);
    const confirmation = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirmation).getByRole("button", { name: "삭제" }));

    await waitFor(() => expect(calls.some((call) => call.method === "DELETE")).toBe(true));
    expect(calls.find((call) => call.method === "DELETE")?.url).toBe("/api/v1/budgets/budget-food-default");
  });

  test("deletes a saved total using the id returned by the API", async () => {
    render(<BudgetView />);
    fireEvent.click(await screen.findByRole("button", { name: "총 예산 설정" }));
    fireEvent.change(screen.getByLabelText("금액"), { target: { value: "100000" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await screen.findByText("100,000원 남았어요");
    fireEvent.click(screen.getByRole("button", { name: "총 예산 설정" }));
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    const confirmation = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirmation).getByRole("button", { name: "삭제" }));

    await waitFor(() => expect(calls.some((call) => call.method === "DELETE")).toBe(true));
    expect(calls.find((call) => call.method === "DELETE")?.url).toBe("/api/v1/budgets/budget-1");
  });

  test("loads the selected override scope and removes it to reveal the default", async () => {
    currentStatus = {
      ...status,
      categories: [
        {
          category_id: "food",
          budget_id: "budget-food-month",
          budget_month: "2026-10",
          name: "식비",
          icon: "utensils",
          color: "cat-2",
          budget: 60_000,
          spent: 50_000,
          remaining: 10_000,
          pct: 83.33,
          over: false,
        },
      ],
    };
    render(<BudgetView />);
    fireEvent.click(await screen.findByRole("button", { name: "식비 예산 수정" }));

    expect(screen.getByRole("radio", { name: "이번 달만" }).matches(":checked")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    const confirmation = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirmation).getByRole("button", { name: "삭제" }));

    await screen.findByText("50,000원 / 40,000원");
    expect(calls.find((call) => call.method === "DELETE")?.url).toBe("/api/v1/budgets/budget-food-month");
  });
});
