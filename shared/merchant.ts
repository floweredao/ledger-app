const MIN_PARTIAL_RULE_LENGTH = 4;

/** Normalized merchant identity: NFKC, lowercase, corporate markers removed, only Hangul syllables, a-z and 0-9 kept. */
export function merchantKey(merchant: string): string {
  return merchant
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll("(주)", "")
    .replaceAll("㈜", "")
    .replaceAll("주식회사", "")
    .replace(/[^가-힣a-z0-9]/g, "");
}

/**
 * The rule key that applies to `key`: an exact match, else the longest rule key of at least
 * four characters that is a prefix of `key` or that `key` is a prefix of. `null` when none applies.
 */
export function matchRule(key: string, ruleKeys: Iterable<string>): string | null {
  if (key === "") return null;
  let best: string | null = null;
  for (const rule of ruleKeys) {
    if (rule === key) return rule;
    if (rule.length < MIN_PARTIAL_RULE_LENGTH) continue;
    if ((key.startsWith(rule) || rule.startsWith(key)) && (best === null || rule.length > best.length)) best = rule;
  }
  return best;
}
