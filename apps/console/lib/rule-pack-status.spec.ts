import { parseRulePackStatus } from '@/lib/rule-pack-status';
import { SUPPORTED_FIXTURE } from '@kosha/shared/fixtures';
import { describe, expect, it } from 'vitest';

describe('parseRulePackStatus', () => {
  it("reads Core's own /v1/supported answer", () => {
    expect(parseRulePackStatus(SUPPORTED_FIXTURE)).toEqual({
      id: 'in-2026.2',
      reviewed: false,
      source: 'core'
    });
  });

  it('reads an unreviewed pack from Core', () => {
    expect(
      parseRulePackStatus({ kosha: { rulepack: { id: 'in-2026.2', reviewedBy: null } } })
    ).toEqual({
      id: 'in-2026.2',
      reviewed: false,
      source: 'core'
    });
  });

  it('marks a pack reviewed once a CA has signed it', () => {
    expect(
      parseRulePackStatus({
        kinds: [],
        kosha: { rulepack: { id: 'in-2026.3', reviewedBy: 'CA Rao' } }
      })
    ).toMatchObject({ id: 'in-2026.3', reviewed: true });
  });

  it.each([
    null,
    {},
    { kosha: { rulepack: { id: '', reviewedBy: null } } },
    // The shape the badge used to expect, which Core never sent
    { rulepack: { id: 'in-2026.2', reviewedBy: null } }
  ])('returns null for an answer it cannot read: %j', (body) => {
    expect(parseRulePackStatus(body)).toBeNull();
  });
});
