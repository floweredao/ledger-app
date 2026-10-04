// Subscribe to stdout before startup; no readiness polling or real ledger module.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [runtime, port = "4339"] = process.argv.slice(2);
const scratch = mkdtempSync(join(tmpdir(), "ledger-preflight-"));
let child;
try {
  mkdirSync(join(scratch, "watch"));
  await Bun.write(join(scratch, "ledger.ts"), "export async function entries() { return []; }\n");
  child = Bun.spawn([process.execPath, join(runtime, "server.js")], {
    cwd: runtime,
    env: {
      ...process.env,
      LEDGER_HOST: "127.0.0.1",
      LEDGER_PORT: port,
      LEDGER_DATA_DIR: join(scratch, "data"),
      LEDGER_STATIC_DIR: join(runtime, "dist"),
      LEDGER_MODULE: join(scratch, "ledger.ts"),
      LEDGER_WATCH_DIR: join(scratch, "watch"),
      LEDGER_TAILSCALE_HOST: "",
      LEDGER_TAILSCALE_LOGIN: "",
      LEDGER_ALLOWED_ORIGINS: "",
    },
    stdout: "pipe",
    stderr: "ignore",
  });
  const ready = (async () => {
    let text = "";
    for await (const chunk of child.stdout) {
      text += new TextDecoder().decode(chunk);
      if (text.includes(`listening on 127.0.0.1:${port}`)) return;
    }
    throw new Error("Preflight exited before readiness.");
  })();
  let timer;
  try {
    await Promise.race([
      ready,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Preflight readiness timeout.")), 10000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(5000) });
  const body = await response.json();
  if (response.status !== 200 || body.ok !== true || !/^0\.0\./.test(body.version)) {
    throw new Error("Preflight health failed.");
  }
  console.log(`Isolated bundle health HTTP 200 on 127.0.0.1:${port}.`);
} finally {
  if (child) {
    child.kill("SIGTERM");
    await child.exited;
  }
  rmSync(scratch, { recursive: true, force: true });
}
