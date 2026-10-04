import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import "fake-indexeddb/auto";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { ToastRegion } from "../components/Toast";
import { storedRequest } from "../features/offline/storage";
import {
  applyOverlay,
  flushOutbox,
  isPendingTransaction,
  type MutationRequest,
  sendMutation,
  usePendingCount,
} from "./outbox";
import { markNetwork } from "./transport";

const realFetch = globalThis.fetch;
const fetchSpy = spyOn(globalThis, "fetch");
const input = {
  id: "019a0000-0000-7000-8000-000000000001",
  type: "expense",
  occurred_at: "2026-10-03T12:00:00+09:00",
  amount: 4500,
  merchant: "샘플카페",
} as const;
const request: MutationRequest = { id: "request-a", method: "POST", path: "transactions", body: input };
let sent: string[] = [];
let respond = (_id: string) => new Response(JSON.stringify(input), { status: 201 });

function Count() {
  return createElement("output", { "aria-label": "pending" }, usePendingCount());
}

beforeEach(async () => {
  markNetwork(true);
  fetchSpy.mockImplementation(
    Object.assign(
      async (_url: RequestInfo | URL, options?: RequestInit) => {
        const id = new Headers(options?.headers).get("Idempotency-Key") ?? "";
        sent.push(id);
        return respond(id);
      },
      { preconnect: realFetch.preconnect },
    ),
  );
  respond = () => new Response(JSON.stringify(input), { status: 201 });
  await flushOutbox();
  sent = [];
});
afterEach(() => {
  cleanup();
  markNetwork(true);
});
afterAll(async () => {
  respond = () => new Response(JSON.stringify(input), { status: 201 });
  await flushOutbox();
  fetchSpy.mockRestore();
});

test("offline mutations resolve optimistically without making a network request", async () => {
  // Given
  markNetwork(false);
  render(createElement(Count));
  // When
  let result: unknown;
  await act(async () => {
    result = await sendMutation(request);
  });
  // Then
  expect(result).toEqual({ queued: true, id: request.id });
  expect(sent).toEqual([]);
  expect((await screen.findByText("1")).textContent).toBe("1");
});

test("network failure persists a queued create that overlays the matching list", async () => {
  // Given
  fetchSpy.mockImplementation(
    Object.assign(
      async () => {
        throw new TypeError("Network unavailable");
      },
      { preconnect: realFetch.preconnect },
    ),
  );
  const list = { items: [], totals: { income: 0, expense: 0, net: 0, count: 0 }, next_cursor: null };
  // When
  expect(await sendMutation(request)).toEqual({ queued: true, id: request.id });
  // Then
  const overlay = applyOverlay("transactions?from=2026-10-01&to=2026-10-31", list);
  expect(overlay.items).toMatchObject([{ id: input.id, amount: 4500, source: "manual" }]);
  expect(overlay.totals).toEqual({ income: 0, expense: 4500, net: -4500, count: 1 });
  expect(isPendingTransaction(input.id)).toBe(true);
  expect(isPendingTransaction(request.id)).toBe(false);
  expect(applyOverlay("transactions?from=2026-09-01&to=2026-09-30", list)).toEqual(list);
});

test("concurrent flushes replay queued requests in insertion order only once", async () => {
  // Given
  markNetwork(false);
  await sendMutation({ ...request, id: "z-first" });
  await sendMutation({ ...request, id: "a-second" });
  expect(sent).toEqual([]);
  markNetwork(true);
  // When
  await Promise.all([flushOutbox(), flushOutbox()]);
  await act(async () => {
    await flushOutbox();
  });
  // Then
  expect(sent).toEqual(["z-first", "a-second"]);
});

test("a lost success response replays the same idempotency key without a second create", async () => {
  // Given: wire-level fake retains the server's idempotency result.
  const created = new Set<string>();
  fetchSpy.mockImplementation(
    Object.assign(
      async (_url: RequestInfo | URL, options?: RequestInit) => {
        const id = new Headers(options?.headers).get("Idempotency-Key") ?? "";
        if (!created.has(id)) {
          created.add(id);
          throw new TypeError("Response lost after commit");
        }
        return new Response(JSON.stringify(input), { status: 201 });
      },
      { preconnect: realFetch.preconnect },
    ),
  );
  // When
  await sendMutation(request);
  markNetwork(true);
  await flushOutbox();
  // Then
  expect([...created]).toEqual([request.id]);
  render(createElement(Count));
  expect((await screen.findByText("0")).textContent).toBe("0");
});

test("a rejected queued item is dropped with a toast and does not block its successor", async () => {
  // Given
  markNetwork(false);
  await sendMutation({ ...request, id: "malformed", body: { amount: -1 } });
  await sendMutation({ ...request, id: "valid-next" });
  respond = (id) =>
    id === "malformed"
      ? new Response(JSON.stringify({ error: { code: "invalid_input", message: "금액 오류" } }), { status: 400 })
      : new Response(JSON.stringify(input), { status: 201 });
  render(createElement(ToastRegion));
  markNetwork(true);
  // When
  await act(async () => {
    await flushOutbox();
  });
  // Then
  expect(sent).toEqual(["malformed", "valid-next"]);
  expect(screen.getByRole("status").textContent).toContain("금액 오류");
  await flushOutbox();
  expect(sent).toHaveLength(2);
});

test("server failure retains the head and prevents later requests overtaking it", async () => {
  // Given
  markNetwork(false);
  await sendMutation({ ...request, id: "head" });
  await sendMutation({ ...request, id: "tail" });
  respond = () => new Response("{}", { status: 503 });
  markNetwork(true);
  // When
  await flushOutbox();
  // Then
  expect(sent).toEqual(["head"]);
});

test("duplicate queued request IDs occupy only one durable queue record", async () => {
  // Given
  markNetwork(false);
  await sendMutation(request);
  // When
  await sendMutation(request);
  markNetwork(true);
  await flushOutbox();
  // Then
  expect(sent).toEqual([request.id]);
});

test("the overlay does not duplicate a create already present in the cached response", async () => {
  // Given
  markNetwork(false);
  await sendMutation(request);
  const list = { items: [], totals: { income: 0, expense: 0, net: 0, count: 0 }, next_cursor: null };
  const first = applyOverlay("transactions", list);
  // When
  const second = applyOverlay("transactions", first);
  // Then
  expect(second).toEqual(first);
});

test("overlay dates use KST and honor type amount and search filters", async () => {
  // Given
  markNetwork(false);
  await sendMutation({ ...request, body: { ...input, occurred_at: "2026-10-02T15:00:00Z" } });
  const list = { items: [], totals: { income: 0, expense: 0, net: 0, count: 0 }, next_cursor: null };
  // When
  const included = applyOverlay("transactions?from=2026-10-03&to=2026-10-03&q=샘플&min=4500", list);
  // Then
  expect(included.items).toHaveLength(1);
  for (const query of ["to=2026-10-02", "type=income", "max=4499", "q=없는가게", "hidden=only"])
    expect(applyOverlay(`transactions?${query}`, list).items).toHaveLength(0);
});

test.each([401, 403, 429])("status %i retains durable queued writes until recovery", async (status) => {
  markNetwork(false);
  await sendMutation(request);
  await sendMutation({ ...request, id: "after-auth" });
  respond = () => new Response("{}", { status });
  markNetwork(true);
  await flushOutbox();
  expect(sent).toEqual([request.id]);
  expect(await storedRequest("outbox", "readonly", (store) => store.getAll())).toHaveLength(2);
  render(createElement(Count));
  expect((await screen.findByText("2")).textContent).toBe("2");
  respond = () => new Response(JSON.stringify(input), { status: 201 });
  await act(async () => {
    await flushOutbox();
  });
  expect(sent).toEqual([request.id, request.id, "after-auth"]);
  expect(await storedRequest("outbox", "readonly", (store) => store.getAll())).toHaveLength(0);
  expect((await screen.findByText("0")).textContent).toBe("0");
});
