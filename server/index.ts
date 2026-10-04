import { join } from "node:path";
import { createApp, parseConfig } from "./app";
import { openDb } from "./db";
import { createImporter } from "./importer/run";
import { startJobs } from "./jobs";

const config = parseConfig(process.env);
const db = openDb(join(config.LEDGER_DATA_DIR, "ledger.sqlite"));
const importer = createImporter({ db, modulePath: config.LEDGER_MODULE });
const app = createApp({ db, env: config, importer });
const server = Bun.serve({ hostname: config.LEDGER_HOST, port: config.LEDGER_PORT, fetch: app.fetch });
const stopJobs = startJobs({ db, env: config, importer });
console.log(`listening on ${config.LEDGER_HOST}:${server.port}`);

function shutdown() {
  stopJobs();
  server.stop(true);
  db.close();
  process.exit(0);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
