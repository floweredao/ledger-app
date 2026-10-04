import { afterEach, expect, test } from "bun:test";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../server/app";
import { createImporter } from "../server/importer/run";
import { startBackupJob } from "../server/jobs/backup";
import { kstDate } from "../shared/dates";
import { authed, makeTestApp, type TestApp } from "./helpers";

const contexts: TestApp[] = [];
const stops: (() => void)[] = [];
const setup = () => {
  const context = makeTestApp();
  contexts.push(context);
  return context;
};
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const context of contexts.splice(0)) context.cleanup();
});

test("an invalid settings patch leaves earlier fields unchanged", async () => {
  const context = setup();
  const request = await authed(context);
  const response = await request("/api/v1/settings", {
    method: "PATCH",
    body: { month_start_day: 25, default_asset_id: Bun.randomUUIDv7() },
  });
  expect(response.status).toBe(400);
  expect((await (await request("/api/v1/settings")).json()).month_start_day).toBe(1);
});

test("changing the owner name reclassifies existing imported transfers", async () => {
  const context = setup();
  const modulePath = join(context.dataDir, "source.ts");
  const entries = [
    {
      id: -1,
      at: "2026-01-02T12:00:00+09:00",
      account: "2222",
      kind: "일반입금",
      amount: 1000,
      counterparty: "홍길동",
      balance: 1000,
      source: "excel",
    },
  ];
  writeFileSync(modulePath, `export function entries() { return ${JSON.stringify(entries)}; }\n`);
  const importer = createImporter({ db: context.db, modulePath });
  expect((await importer.run()).inserted).toBe(1);
  const app = createApp({ db: context.db, env: context.config, importer });
  const request = await authed({ ...context, request: async (path, init) => app.request(path, init) });
  expect((await request("/api/v1/settings", { method: "PATCH", body: { owner_name: "홍길동" } })).status).toBe(200);
  expect(context.db.query<{ type: string }, []>("SELECT type FROM transactions").get()?.type).toBe("transfer");
});

test("restore rejects malformed rows without changing the existing ledger", async () => {
  const context = setup();
  const request = await authed(context);
  const backup = await (await request("/api/v1/backup")).json();
  const originalName = backup.tables.assets[0].name;
  backup.tables.assets[0].kind = "invalid-kind";
  expect((await request("/api/v1/backup/restore?confirm=REPLACE", { method: "POST", body: backup })).status).toBe(400);
  expect(context.db.query<{ name: string }, []>("SELECT name FROM assets").get()?.name).toBe(originalName);
});

test("restore accepts linked assets in any exported row order", async () => {
  const context = setup();
  const request = await authed(context);
  const bankResponse = await request("/api/v1/assets", {
    method: "POST",
    body: { name: "테스트은행", kind: "bank" },
  });
  expect(bankResponse.status).toBe(201);
  const bank = await bankResponse.json();
  const cardResponse = await request("/api/v1/assets", {
    method: "POST",
    body: { name: "테스트카드", kind: "check_card", linked_asset_id: bank.id },
  });
  expect(cardResponse.status).toBe(201);
  const backup = await (await request("/api/v1/backup")).json();
  backup.tables.assets.reverse();
  expect((await request("/api/v1/backup/restore?confirm=REPLACE", { method: "POST", body: backup })).status).toBe(200);
  expect(context.db.query<{ count: number }, []>("SELECT count(*) AS count FROM assets").get()?.count).toBe(3);
});

test("backup restart preserves today's snapshot and still prunes old files", () => {
  const context = setup();
  const directory = join(context.dataDir, "backups");
  mkdirSync(directory);
  const today = `ledger-${kstDate().replaceAll("-", "")}.sqlite`;
  context.db.query("VACUUM INTO ?").run(join(directory, today));
  for (let day = 1; day <= 35; day++) {
    const date = new Date(Date.UTC(2020, 0, day)).toISOString().slice(0, 10).replaceAll("-", "");
    writeFileSync(join(directory, `ledger-${date}.sqlite`), "old synthetic snapshot");
  }
  stops.push(startBackupJob({ db: context.db, dataDir: context.dataDir }));
  const files = readdirSync(directory);
  expect(files).toHaveLength(30);
  expect(files).toContain(today);
});
