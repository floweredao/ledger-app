export type FixtureEntry = {
  id: number;
  at: string;
  account: string;
  kind: string;
  amount: number;
  counterparty: string;
  balance: number | null;
  currency?: string;
  source?: string;
};

let current: unknown = [];
let gate: Promise<void> | undefined;
let entered: (() => void) | undefined;

export function setEntries(value: unknown, wait?: Promise<void>, signal?: () => void): void {
  current = value;
  gate = wait;
  entered = signal;
}

export async function entries(): Promise<unknown> {
  entered?.();
  await gate;
  return current;
}
