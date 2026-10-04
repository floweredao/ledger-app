import type { Database } from "bun:sqlite";
import type { Config, Importer } from "../app";
import { startImportWatcher } from "../importer/watch";
import { startBackupJob } from "./backup";
import { startRecurringJob } from "./recurring";

export function startJobs(options: { db: Database; env: Config; importer?: Importer }): () => void {
  const { db, env, importer } = options;

  const backupJobStop = startBackupJob({ db, dataDir: env.LEDGER_DATA_DIR });
  const recurringJobStop = startRecurringJob(db);
  const importJobStop = importer
    ? startImportWatcher({
        importer,
        dir: env.LEDGER_WATCH_DIR,
        intervalMs: env.LEDGER_IMPORT_INTERVAL_MS,
      })
    : undefined;

  return () => {
    importJobStop?.();
    recurringJobStop();
    backupJobStop();
  };
}
