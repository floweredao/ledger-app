import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

// Mirrors entries() of ~/.local/share/ddolmeng-mode/bin/ledger.ts with synthetic paths and accounts.
const EntrySchema = z.looseObject({
  id: z.number(),
  at: z.string(),
  account: z.string(),
  kind: z.string(),
  amount: z.number(),
  counterparty: z.string(),
  balance: z.number().nullable(),
  currency: z.string().optional(),
});
export type Entry = z.infer<typeof EntrySchema>;

const CARD_ACCOUNT: Record<string, string> = { "1111": "2222" };
const readJsonl = (path: string | undefined): Entry[] =>
  path && existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => EntrySchema.parse(JSON.parse(line)))
    : [];

export function entries(): Entry[] {
  const excel = readJsonl(process.env.FAKE_LEDGER_EXCEL_FILE);
  const cutoff = excel.reduce((max, entry) => (entry.at > max ? entry.at : max), "");
  const sms = readJsonl(process.env.FAKE_LEDGER_FILE)
    .map((entry) => ({ ...entry, account: CARD_ACCOUNT[entry.account] ?? entry.account }))
    .filter((entry) => entry.at > cutoff);
  return [...excel, ...sms].sort((a, b) => a.at.localeCompare(b.at));
}
