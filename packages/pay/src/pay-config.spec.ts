import { parsePayConfig } from './pay-config';
import { PAY_CONFIG, PAYER_KEY as KEY } from './pay-config.fixture';
import { describe, expect, it } from 'vitest';

describe('parsePayConfig', () => {
  it('parses the key, fills defaults and names a Level 0 agent by its account', () => {
    const result = parsePayConfig(PAY_CONFIG);

    if (!result.ok) {
      throw new Error(result.data.reason);
    }
    expect(result.data.privateKey.toStringDer()).toBe(KEY.toStringDer());
    expect(result.data).toMatchObject({
      agentId: 'hedera:testnet:0.0.6001',
      maxTransactionFeeHbar: '2',
      policy: { perPaymentUsdc: 500_000n, onThreshold: 'warn' }
    });
  });

  it('keeps a registered UAID', () => {
    const agentId = 'uaid:aid:abc123;uid=0;registry=kosha';
    const result = parsePayConfig({ ...PAY_CONFIG, agentId });

    expect(result.ok && result.data.agentId).toBe(agentId);
  });

  it('names the invalid fields without echoing the key', () => {
    const result = parsePayConfig({
      ...PAY_CONFIG,
      reserveAccountId: 'reserve',
      trustedFacilitators: []
    });

    expect(result).toEqual({
      ok: false,
      data: {
        reason: 'invalid_config',
        issues: [
          expect.stringMatching(/^reserveAccountId: /),
          expect.stringMatching(/^trustedFacilitators: /)
        ]
      }
    });
    expect(JSON.stringify(result)).not.toContain(KEY.toStringDer());
  });

  it('reports a key it cannot parse', () => {
    expect(parsePayConfig({ ...PAY_CONFIG, privateKey: 'not-a-key' })).toEqual({
      ok: false,
      data: { reason: 'unrecognised_key' }
    });
  });
});
