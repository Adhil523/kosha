import { lookupUrl, payOnceConfig, readPayOnceEnv } from './pay-once';
import { PrivateKey } from '@hiero-ledger/sdk';
import { parsePayConfig } from '@kosha/pay/pay-config';
import { describe, expect, it } from 'vitest';

const AGENT_KEY = PrivateKey.generateED25519();

const ENV = {
  HEDERA_NETWORK: 'testnet',
  CORE_ACCOUNT_ID: '0.0.4000',
  SETTLEMENT_TOKEN_ID: '0.0.429274',
  AGENT_RESIDENT_ACCOUNT_ID: '0.0.6001',
  AGENT_RESIDENT_PRIVATE_KEY: AGENT_KEY.toStringDer(),
  AGENT_RESIDENT_RESERVE_ID: '0.0.6101',
  HCS_PAYMENTS_TOPIC: '0.0.7001',
  MAX_TX_FEE_HBAR: '2'
};

describe('readPayOnceEnv', () => {
  it('names the missing keys and never their values', () => {
    const { AGENT_RESIDENT_RESERVE_ID: _reserve, ...partial } = ENV;
    const result = readPayOnceEnv({ ...partial, AGENT_RESIDENT_PRIVATE_KEY: '' });

    expect(result).toEqual({
      ok: false,
      data: { keys: ['AGENT_RESIDENT_PRIVATE_KEY', 'AGENT_RESIDENT_RESERVE_ID'] }
    });
    expect(JSON.stringify(result)).not.toContain(ENV.AGENT_RESIDENT_PRIVATE_KEY);
  });

  it('defaults to the demo API on port 4101', () => {
    const result = readPayOnceEnv(ENV);
    if (!result.ok) throw new Error('expected the env to parse');

    expect(lookupUrl(result.data)).toBe(
      'http://localhost:4101/v1/gst-lookup?gstin=29AAKCK4821M1ZQ'
    );
  });
});

describe('payOnceConfig', () => {
  it('builds options Kosha Pay accepts for agent-resident', () => {
    const env = readPayOnceEnv({ ...ENV, DEMO_API_IN_PORT: '4201' });
    if (!env.ok) throw new Error('expected the env to parse');

    const parsed = parsePayConfig(payOnceConfig(env.data));
    if (!parsed.ok) throw new Error('expected Kosha Pay to accept the options');

    expect(parsed.data).toMatchObject({
      accountId: '0.0.6001',
      reserveAccountId: '0.0.6101',
      asset: '0.0.429274',
      trustedFacilitators: ['0.0.4000'],
      agentId: 'hedera:testnet:0.0.6001',
      policy: { allowlist: ['localhost'] }
    });
    expect(lookupUrl(env.data)).toContain('http://localhost:4201/');
  });

  it('targets and allowlists a deployed demo API when DEMO_API_IN_URL is set', () => {
    const env = readPayOnceEnv({ ...ENV, DEMO_API_IN_URL: 'https://kosha-demo-api-in.fly.dev' });
    if (!env.ok) throw new Error('expected the env to parse');

    expect(lookupUrl(env.data)).toBe(
      'https://kosha-demo-api-in.fly.dev/v1/gst-lookup?gstin=29AAKCK4821M1ZQ'
    );
    expect(payOnceConfig(env.data).policy.allowlist).toEqual(['kosha-demo-api-in.fly.dev']);
  });
});
