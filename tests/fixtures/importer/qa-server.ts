import { join } from "node:path";
import { createApp, parseConfig } from "../../../server/app";
import { openDb } from "../../../server/db";
import { createImporter } from "../../../server/importer/run";

// Inject the real importer without editing another lane's server/index.ts wiring.
const config = parseConfig(process.env);
const db = openDb(join(config.LEDGER_DATA_DIR, "ledger.sqlite"));
const importer = createImporter({ db, modulePath: config.LEDGER_MODULE });
const app = createApp({ db, env: config, importer });
const server = Bun.serve({ hostname: config.LEDGER_HOST, port: config.LEDGER_PORT, fetch: app.fetch });
console.log(`IMPORTER_QA_READY ${server.hostname}:${server.port}`);
const stop = () => {
  server.stop(true);
  db.close();
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
