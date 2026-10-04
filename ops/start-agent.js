// Subscribe to the new startup log before bootstrap; never poll or read old readiness.
import { closeSync, openSync, readSync, statSync, watch } from "node:fs";

const [runtime, domain, plist] = process.argv.slice(2);
const log = `${runtime}/data/logs/server.log`;
const fd = openSync(log, "a+", 0o600);
let offset = statSync(log).size;
let text = "";
let watcher;
let timer;
try {
  const ready = Promise.withResolvers();
  const checkReady = () => {
    const size = statSync(log).size;
    if (size < offset) offset = 0;
    const bytes = Buffer.alloc(size - offset);
    const count = readSync(fd, bytes, 0, bytes.length, offset);
    offset += count;
    text += bytes.subarray(0, count).toString();
    const found = text.includes("listening on 127.0.0.1:4340");
    if (found) ready.resolve();
    return found;
  };
  watcher = watch(log, checkReady);
  timer = setTimeout(() => {
    if (!checkReady()) ready.reject(new Error("Own LaunchAgent startup timeout."));
  }, 10000);
  const child = Bun.spawn(["launchctl", "bootstrap", domain, plist], { stdout: "inherit", stderr: "inherit" });
  // Await both so timeout rejection is always observed even if bootstrap fails.
  await Promise.all([
    ready.promise,
    child.exited.then((code) => {
      if (code !== 0) throw new Error("Own LaunchAgent bootstrap failed.");
      checkReady();
    }),
  ]);
  const response = await fetch("http://127.0.0.1:4340/api/v1/health", { signal: AbortSignal.timeout(5000) });
  if (response.status !== 200 || (await response.json()).ok !== true) throw new Error("Own agent health failed.");
  console.error("Own LaunchAgent health HTTP 200.");
} finally {
  clearTimeout(timer);
  watcher?.close();
  closeSync(fd);
}
