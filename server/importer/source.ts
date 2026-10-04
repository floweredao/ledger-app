import { resolve } from "node:path";
import { z } from "zod";

export const EntrySchema = z.looseObject({
  id: z.number().int(),
  at: z.iso.datetime({ offset: true }),
  account: z.string().min(1),
  kind: z.string(),
  amount: z.number().finite(),
  counterparty: z.string(),
  balance: z.number().int().nullable(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  source: z.enum(["excel", "sms"]).optional(),
});
export type Entry = z.infer<typeof EntrySchema>;

const ModuleSchema = z.object({ entries: z.custom<() => unknown>((value) => typeof value === "function") });
const modules = new Map<string, Promise<z.infer<typeof ModuleSchema>>>();

/** Cache the module, never its entries: the source owns file reads on every invocation. */
export async function loadEntries(modulePath: string): Promise<Entry[]> {
  const path = resolve(modulePath);
  let module = modules.get(path);
  if (!module) {
    module = import(path).then((value: unknown) => ModuleSchema.parse(value));
    modules.set(path, module);
  }
  const source = await module;
  return z
    .array(EntrySchema)
    .parse(await source.entries())
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export function sourceKey(entry: Entry): string {
  return entry.source === "excel"
    ? `kb-excel:${entry.account}|${entry.at}|${entry.amount}|${entry.balance}`
    : `kb-sms:${entry.id}`;
}
