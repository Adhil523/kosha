const escapeRegExp = (text: string): string => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

// Glob match for Pay's `acceptRulepacks`: `*` matches any run of characters, everything else is literal.
// e.g. rulepackMatches('in-2026.1', ['in-2026.*']) === true
export const rulepackMatches = (id: string, patterns: readonly string[]): boolean =>
  patterns.some((pattern) => {
    const source = pattern.split('*').map(escapeRegExp).join('.*');
    return new RegExp(`^${source}$`).test(id);
  });
