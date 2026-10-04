import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

test("the actual server injects a working, idempotent importer into the sync API", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ledger-startup-sync-"));
  const excelFile = join(dataDir, "source.jsonl");
  const origin = "http://127.0.0.1:4358";
  writeFileSync(
    excelFile,
    `${JSON.stringify({
      id: -1,
      at: "2026-10-04T09:00:00+09:00",
      account: "2222",
      kind: "체크카드결제",
      amount: -4500,
      counterparty: "샘플카페",
      balance: 95500,
      source: "excel",
    })}\n`,
  );
  const child = Bun.spawn(["bun", join(import.meta.dir, "../server/index.ts")], {
    env: {
      ...process.env,
      LEDGER_HOST: "127.0.0.1",
      LEDGER_PORT: "0",
      LEDGER_DATA_DIR: dataDir,
      LEDGER_MODULE: join(import.meta.dir, "fixtures/fake-ledger.ts"),
      LEDGER_WATCH_DIR: dataDir,
      LEDGER_ALLOWED_ORIGINS: origin,
      FAKE_LEDGER_EXCEL_FILE: excelFile,
      FAKE_LEDGER_FILE: join(dataDir, "missing-sms.jsonl"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = new Response(child.stderr).text();
  const deadline = AbortSignal.timeout(15_000);
  const abort = () => child.kill("SIGKILL");
  deadline.addEventListener("abort", abort, { once: true });
  const reader = child.stdout.getReader();
  let database: Database | undefined;
  try {
    const decoder = new TextDecoder();
    let output = "";
    let port: string | undefined;
    while (!port) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error(`Server exited before readiness: ${await stderr}`);
      output += decoder.decode(chunk.value, { stream: true });
      port = output.match(/listening on 127\.0\.0\.1:(\d+)\n/)?.[1];
    }
    const base = `http://127.0.0.1:${port}`;
    const credentials = z
      .object({ owner_token: z.string() })
      .parse(JSON.parse(readFileSync(join(dataDir, "credentials.json"), "utf8")));
    const login = await fetch(`${base}/api/v1/auth/session`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ token: credentials.owner_token }),
      signal: deadline,
    });
    expect(login.status).toBe(200);
    const session = z.object({ csrf_token: z.string() }).parse(await login.json());
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("Test session cookie missing");
    const headers = { Origin: origin, Cookie: cookie, "X-CSRF-Token": session.csrf_token };
    const first = await fetch(`${base}/api/v1/sync/run`, { method: "POST", headers, signal: deadline });
    expect(first.status).toBe(200);
    expect((await first.json()).errors).toEqual([]);
    const second = await fetch(`${base}/api/v1/sync/run`, { method: "POST", headers, signal: deadline });
    expect(second.status).toBe(200);
    expect((await second.json()).inserted).toBe(0);
    database = new Database(join(dataDir, "ledger.sqlite"), { readonly: true });
    expect(database.query<{ count: number }, []>("SELECT count(*) AS count FROM transactions").get()?.count).toBe(1);
  } finally {
    database?.close();
    child.kill("SIGTERM");
    await child.exited;
    deadline.removeEventListener("abort", abort);
    reader.releaseLock();
    rmSync(dataDir, { recursive: true, force: true });
  }
}, 20_000);
