import assert from "node:assert/strict";
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const origin = "http://127.0.0.1:4373";
const dir = process.env.LEDGER_DATA_DIR;
if (!dir) throw new Error("QA data directory required");
const sms = join(dir, "sms.jsonl");
const excel = join(dir, "excel.jsonl");
const entry = {
  id: 1,
  at: "2026-10-03T10:00:00+09:00",
  account: "1111",
  kind: "체크카드결제",
  amount: -4500,
  counterparty: "샘플카페",
  balance: 95500,
};
const login = await fetch(`${origin}/api/v1/auth/session`, {
  method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json" },
  body: JSON.stringify({ token: JSON.parse(readFileSync(join(dir, "credentials.json"), "utf8")).owner_token }),
});
assert.equal(login.status, 200);
const session = await login.json();
const headers = {
  Origin: origin,
  "Content-Type": "application/json",
  Cookie: (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "",
  "X-CSRF-Token": session.csrf_token,
};
const request = async (path: string, method = "GET", body?: unknown) => {
  const response = await fetch(`${origin}/api/v1${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
};
const sync = async (
  label: string,
  expected: { inserted: number; merged: number; skipped: number; errors: string[] },
) => {
  const result = await request("/sync/run", "POST");
  assert.equal(result.status, 200);
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(result.body[key], value);
  console.log(JSON.stringify({ scenario: label, method: "POST", path: "/api/v1/sync/run", ...result }));
};
await sync("empty initial source", { inserted: 0, merged: 0, skipped: 0, errors: [] });
appendFileSync(sms, `${JSON.stringify(entry)}\n`);
await sync("append synthetic SMS", { inserted: 1, merged: 0, skipped: 0, errors: [] });
await sync("repeat import", { inserted: 0, merged: 0, skipped: 1, errors: [] });
const list = await request("/transactions");
assert.equal(list.status, 200);
assert.equal(list.body.items.length, 1);
const original = list.body.items[0];
const categories = await request("/categories");
assert.equal(categories.status, 200);
const online = categories.body.items
  .flatMap((item: { children: unknown[] }) => item.children ?? [])
  .find((item: { name: string }) => item.name === "온라인");
assert.ok(online);
const patch = await request(`/transactions/${original.id}`, "PATCH", {
  amount: 7000,
  occurred_at: "2026-10-03T11:00:00+09:00",
  memo: "synthetic owner memo",
  category_id: online.id,
  learn: true,
});
assert.equal(patch.status, 200);
writeFileSync(
  excel,
  `${JSON.stringify({ ...entry, id: 20, source: "excel", account: "2222", at: "2026-10-03T10:02:00+09:00" })}\n`,
);
await sync("excel supersession after owner edits", { inserted: 0, merged: 1, skipped: 0, errors: [] });
const merged = await request("/transactions");
assert.equal(merged.body.items.length, 1);
assert.equal(merged.body.items[0].id, original.id);
assert.equal(merged.body.items[0].amount, 7000);
assert.equal(merged.body.items[0].memo, "synthetic owner memo");
assert.equal(merged.body.items[0].category_id, online.id);
assert.equal(merged.body.items[0].occurred_at, "2026-10-03T11:00:00+09:00");
console.log(
  JSON.stringify({
    scenario: "owner fields preserved",
    status: merged.status,
    count: 1,
    same_id: true,
    locked_fields_preserved: true,
  }),
);
appendFileSync(sms, `${JSON.stringify({ ...entry, id: 2, at: "2026-10-03T10:03:00+09:00", balance: 91000 })}\n`);
await sync("future learned classification", { inserted: 1, merged: 0, skipped: 1, errors: [] });
const learned = await request("/transactions");
assert.equal(
  learned.body.items.find((item: { source: string }) => item.source === "kakaobank_sms").category_id,
  online.id,
);
console.log(JSON.stringify({ scenario: "learning affects future imports", status: learned.status, learned: true }));
const noCsrf = await fetch(`${origin}/api/v1/sync/run`, {
  method: "POST",
  headers: { Origin: origin, Cookie: headers.Cookie },
});
assert.equal(noCsrf.status, 403);
console.log(JSON.stringify({ scenario: "missing CSRF", status: noCsrf.status, body: await noCsrf.json() }));
writeFileSync(sms, "{malformed\n");
await sync("malformed source", { inserted: 0, merged: 0, skipped: 0, errors: ["import_failed"] });
const failed = await request("/sync/status");
assert.equal(failed.body.last_error, "import_failed");
console.log(
  JSON.stringify({ scenario: "persisted import error", status: failed.status, last_error: failed.body.last_error }),
);
const health = await fetch(`${origin}/api/v1/health`);
assert.equal(health.status, 200);
console.log(
  JSON.stringify({ scenario: "server survives rejected source", status: health.status, body: await health.json() }),
);
rmSync(sms);
await sync("missing SMS allowed by AM-19", { inserted: 0, merged: 0, skipped: 1, errors: [] });
console.log("IMPORTER_HTTP_PASS");
