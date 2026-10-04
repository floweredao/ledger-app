import type { Database } from "bun:sqlite";
import { kstDate } from "../../shared/dates";
import { materialize } from "../domain/recurring";

const HOUR_MS = 60 * 60 * 1000;

export function startRecurringJob(db: Database): () => void {
  materialize(db, kstDate());
  const timer = setInterval(() => materialize(db, kstDate()), HOUR_MS);
  timer.unref();
  return () => clearInterval(timer);
}
