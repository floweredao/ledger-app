import { beforeEach, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

type WorkerEvent = {
  readonly request: Request;
  readonly waitUntil: (work: Promise<void>) => void;
  readonly respondWith: (work: Promise<Response>) => void;
};
const source = await readFile(new URL("../../../public/sw.js", import.meta.url), "utf8");
const handlers = new Map<string, (event: WorkerEvent) => void>();
let requests: string[] = [];
let connected = true;
let responses = new Map<string, Response>();

beforeEach(() => {
  responses = new Map();
  requests = [];
  connected = true;
  handlers.clear();
  const network = async (request: Request | string) => {
    const url = typeof request === "string" ? request : new URL(request.url).pathname;
    requests.push(url);
    if (!connected) throw new TypeError("Offline");
    return new Response(url === "/index.html" ? "<main>cached shell</main>" : "hashed asset");
  };
  runInNewContext(source, {
    URL,
    fetch: network,
    self: {
      location: { origin: "http://127.0.0.1" },
      addEventListener: (name: string, handler: (event: WorkerEvent) => void) => handlers.set(name, handler),
      skipWaiting: async () => {},
      clients: { claim: async () => {}, matchAll: async () => [] },
    },
    caches: {
      open: async () => ({
        addAll: async (paths: readonly string[]) => {
          for (const path of paths) responses.set(path, await network(path));
        },
        match: async (request: Request | string) =>
          responses.get(typeof request === "string" ? request : new URL(request.url).pathname)?.clone(),
        put: async (request: Request | string, response: Response) =>
          responses.set(typeof request === "string" ? request : new URL(request.url).pathname, response.clone()),
      }),
      keys: async () => [],
      delete: async () => true,
    },
  });
});

async function install(): Promise<void> {
  let work: Promise<void> = Promise.resolve();
  handlers.get("install")?.({
    request: new Request("http://127.0.0.1/"),
    waitUntil: (promise) => {
      work = promise;
    },
    respondWith: () => {},
  });
  await work;
}

function fetchThroughWorker(request: Request): Promise<Response> | undefined {
  let response: Promise<Response> | undefined;
  handlers.get("fetch")?.({
    request,
    waitUntil: () => {},
    respondWith: (work) => {
      response = work;
    },
  });
  return response;
}

test("navigation falls back to precached index.html when the network disappears", async () => {
  // Given
  await install();
  connected = false;
  const request = new Request("http://127.0.0.1/monthly?year=2026");
  Object.defineProperty(request, "mode", { value: "navigate" });
  // When
  const response = await fetchThroughWorker(request);
  // Then
  expect(await response?.text()).toBe("<main>cached shell</main>");
});

test("hashed assets are cache first after a successful fetch", async () => {
  // Given
  const request = new Request("http://127.0.0.1/static/app-abc123.js");
  await fetchThroughWorker(request);
  connected = false;
  // When
  const response = await fetchThroughWorker(request);
  // Then
  expect(await response?.text()).toBe("hashed asset");
  expect(requests).toEqual(["/static/app-abc123.js"]);
});

test("API requests and mutations never enter the worker response cache", () => {
  // Given
  const api = new Request("http://127.0.0.1/api/v1/transactions");
  const mutation = new Request("http://127.0.0.1/assets/app.js", { method: "POST" });
  // When
  const results = [fetchThroughWorker(api), fetchThroughWorker(mutation)];
  // Then
  expect(results).toEqual([undefined, undefined]);
  expect(requests).toEqual([]);
  expect(responses.size).toBe(0);
});
