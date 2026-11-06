import { IN_2026_2 } from './decide.fixture';
import { canonicalJson, rulePackHash } from './rule-pack-hash';
import { describe, expect, it } from 'vitest';

// Python: sha256(json.dumps(pack, sort_keys=True, separators=(',', ':'))) over rulepacks/in-2026.2.json
const IN_2026_2_SHA256 = '96cba86985f77eab5fc51287bc787374a52ebb51e328fab176bc243389b52a3d';

describe('canonicalJson', () => {
  it('sorts keys at every depth and drops whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [true, null], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[true,null]},"b":1}'
    );
  });

  it('writes bigint as a plain integer, matching the number it came from', () => {
    expect(canonicalJson({ paise: 5_000_000n })).toBe(canonicalJson({ paise: 5_000_000 }));
  });

  it('drops undefined keys', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(RangeError);
  });
});

describe('rulePackHash', () => {
  it('matches an independent hash of the shipped in-2026.2 file', () => {
    expect(rulePackHash(IN_2026_2)).toBe(IN_2026_2_SHA256);
  });

  it('changes when any rule changes', () => {
    expect(rulePackHash({ ...IN_2026_2, crossing: 'excess' })).not.toBe(IN_2026_2_SHA256);
    expect(rulePackHash({ ...IN_2026_2, reviewedBy: 'CA Rao' })).not.toBe(IN_2026_2_SHA256);
  });
});
