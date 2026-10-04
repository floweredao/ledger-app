import { type FSWatcher, type WatchListener, watch } from "node:fs";
import { clearInterval, clearTimeout, setInterval, setTimeout } from "node:timers";
import type { Importer } from "./run";

export function startImportWatcher({
  importer,
  dir,
  intervalMs,
  watchDirectory = watch,
  schedule = setTimeout,
}: {
  importer: Importer;
  dir: string | null;
  intervalMs: number;
  watchDirectory?: (path: string, listener: WatchListener<string>) => FSWatcher;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
}): () => void {
  let stopped = false;
  let running: Promise<void> | null = null;
  let pending = false;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let watcher: FSWatcher | undefined;
  const run = (): void => {
    if (stopped) return;
    if (running) {
      pending = true;
      return;
    }
    running = importer
      .run()
      .then(() => {})
      .catch((error: unknown) => {
        if (!(error instanceof Error)) throw error;
        console.error("import_watcher_failed");
      })
      .finally(() => {
        running = null;
        if (pending && !stopped) {
          pending = false;
          run();
        }
      });
  };
  if (dir) {
    try {
      watcher = watchDirectory(dir, (_event, filename) => {
        if (filename?.toString().endsWith(".cursor")) return;
        clearTimeout(debounce);
        debounce = schedule(run, 2000);
      });
      watcher.on("error", () => {
        watcher?.close();
        console.error("import_watch_unavailable");
      });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      console.error("import_watch_unavailable");
    }
  }
  const interval = setInterval(run, intervalMs);
  run();
  return () => {
    stopped = true;
    pending = false;
    clearTimeout(debounce);
    clearInterval(interval);
    watcher?.close();
  };
}
