import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { createImporter, type ImportResult } from "../server/importer/run";
import { startJobs } from "../server/jobs";
import { makeTestApp } from "./helpers";

test("job startup imports the source and materializes due recurring transactions", async () => {
  const app = makeTestApp();
  const source = join(app.dataDir, "fixture.jsonl");
  const previous = {
    FAKE_LEDGER_FILE: process.env.FAKE_LEDGER_FILE,
    FAKE_LEDGER_EXCEL_FILE: process.env.FAKE_LEDGER_EXCEL_FILE,
  };
  writeFileSync(
    source,
    `${JSON.stringify({
      id: -1,
      at: "2026-01-02T12:00:00+09:00",
      account: "2222",
      kind: "일반입금",
      amount: 1000,
      counterparty: "테스트입금",
      balance: 1000,
      source: "excel",
    })}\n`,
  );
  process.env.FAKE_LEDGER_EXCEL_FILE = source;
  process.env.FAKE_LEDGER_FILE = join(app.dataDir, "missing-sms.jsonl");
  const ruleId = Bun.randomUUIDv7();
  app.db
    .query(
      "INSERT INTO recurring_rules(id,template,freq,interval,start_date,end_date,active,created_at,updated_at) VALUES(?,?,'daily',1,'2020-01-01','2020-01-01',1,?,?)",
    )
    .run(
      ruleId,
      JSON.stringify({ type: "expense", amount: 500, merchant: "테스트정기결제" }),
      "2020-01-01T00:00:00+09:00",
      "2020-01-01T00:00:00+09:00",
    );
  const importer = createImporter({ db: app.db, modulePath: join(import.meta.dir, "fixtures/fake-ledger.ts") });
  const imported = Promise.withResolvers<ImportResult>();
  const timeout = setTimeout(() => imported.reject(new Error("Startup importer completion was not signalled")), 5000);
  let stop: (() => void) | undefined;
  try {
    stop = startJobs({
      db: app.db,
      env: { ...app.config, LEDGER_WATCH_DIR: null },
      importer: {
        reclassify: importer.reclassify,
        run: async () => {
          try {
            const result = await importer.run();
            imported.resolve(result);
            return result;
          } catch (error) {
            imported.reject(error);
            throw error;
          }
        },
      },
    });
    expect((await imported.promise).errors).toEqual([]);
    expect(
      app.db
        .query<{ count: number }, []>("SELECT count(*) AS count FROM transactions WHERE source='kakaobank_excel'")
        .get()?.count,
    ).toBe(1);
    expect(
      app.db
        .query<{ count: number }, [string]>("SELECT count(*) AS count FROM transactions WHERE recurring_rule_id=?")
        .get(ruleId)?.count,
    ).toBe(1);
  } finally {
    clearTimeout(timeout);
    stop?.();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    app.cleanup();
  }
}, 10_000);
