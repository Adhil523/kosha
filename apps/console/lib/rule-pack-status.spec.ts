import { parseRulePackStatus } from '@/lib/rule-pack-status';
import { describe, expect, it } from 'vitest';

describe('parseRulePackStatus', () => {
  it('reads an unreviewed pack from Core', () => {
    expect(parseRulePackStatus({ rulepack: { id: 'in-2026.2', reviewedBy: null } })).toEqual({
      id: 'in-2026.2',
      reviewed: false,
      source: 'core'
    });
  });

  it('marks a pack reviewed once a CA has signed it', () => {
    expect(
      parseRulePackStatus({ kinds: [], rulepack: { id: 'in-2026.3', reviewedBy: 'CA Rao' } })
    ).toMatchObject({ id: 'in-2026.3', reviewed: true });
  });

  it.each([null, {}, { rulepack: { id: '', reviewedBy: null } }, { rulepack: 'in-2026.2' }])(
    'returns null for an answer it cannot read: %j',
    (body) => {
      expect(parseRulePackStatus(body)).toBeNull();
    }
  );
});
