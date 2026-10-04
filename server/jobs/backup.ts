import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { clearInterval, setInterval } from "node:timers";
import { kstDate } from "../../shared/dates";

export function startBackupJob({ db, dataDir }: { db: Database; dataDir: string }): () => void {
  const directory = join(dataDir, "backups");
  mkdirSync(directory, { recursive: true });
  const run = () => {
    try {
      const path = join(directory, "ledger-" + kstDate().replaceAll("-", "") + ".sqlite");
      if (!existsSync(path)) db.query("VACUUM INTO ?").run(path);
      const files = readdirSync(directory)
        .filter((file) => /^ledger-\d{8}\.sqlite$/.test(file))
        .sort()
        .reverse();
      for (const file of files.slice(30)) unlinkSync(join(directory, file));
    } catch {
      console.error("backup_failed");
    }
  };
  run();
  const timer = setInterval(run, 24 * 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
