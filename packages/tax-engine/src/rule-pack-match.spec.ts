import { rulepackMatches } from './rule-pack-match';
import { describe, expect, it } from 'vitest';

describe('rulepackMatches', () => {
  it.each([
    ['in-2026.1', ['in-2026.*'], true],
    ['in-2026.12', ['in-2026.*'], true],
    ['in-2026.1', ['in-2026.1'], true],
    ['in-2026.1', ['*'], true],
    ['in-2026.1', ['in-2027.*', 'in-2026.*'], true],
    ['in-2027.1', ['in-2026.*'], false],
    ['in-2026.1', [], false],
    // "." is literal, not a regex wildcard
    ['in-2026x1', ['in-2026.1'], false],
    // the whole id must match, not a prefix
    ['in-2026.1-draft', ['in-2026.1'], false]
  ])('%s against %j is %s', (id, patterns, expected) => {
    expect(rulepackMatches(id, patterns)).toBe(expected);
  });
});
