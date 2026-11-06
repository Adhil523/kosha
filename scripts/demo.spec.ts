import { agentKeys, demoUrls, formatOutcome, payConfigFor, readDemoEnv } from './demo';
import { currentQuarter } from './lib/demo-core';
import { describe, expect, it } from 'vitest';

const ACCOUNT = '0.0.1001';
const ENV: NodeJS.ProcessEnv = {
  HEDERA_NETWORK: 'testnet',
  CORE_URL: 'http://localhost:4100',
  CONSOLE_ADMIN_TOKEN: 'a'.repeat(32),
  ISSUER_PRIVATE_KEY: 'issuer-key',
  DEMO_API_IN_KEY: 'b'.repeat(32),
  DEMO_API_GLOBAL_KEY: 'c'.repeat(32),
  RECEIVER_IN_ACCOUNT_ID: '0.0.2001',
  RECEIVER_IN_PRIVATE_KEY: 'k',
  RECEIVER_IN_SOLO_ACCOUNT_ID: '0.0.2002',
  RECEIVER_IN_SOLO_PRIVATE_KEY: 'k',
  RECEIVER_GLOBAL_ACCOUNT_ID: '0.0.2003',
  RECEIVER_GLOBAL_PRIVATE_KEY: 'k',
  AGENT_RESIDENT_ACCOUNT_ID: ACCOUNT,
  AGENT_RESIDENT_PRIVATE_KEY: 'resident-key',
  AGENT_RESIDENT_RESERVE_ID: '0.0.1101',
  AGENT_NONRESIDENT_ACCOUNT_ID: '0.0.1002',
  AGENT_NONRESIDENT_PRIVATE_KEY: 'k',
  AGENT_NONRESIDENT_RESERVE_ID: '0.0.1102',
  AGENT_UNKNOWN_ACCOUNT_ID: '0.0.1003',
  AGENT_UNKNOWN_PRIVATE_KEY: 'k',
  AGENT_UNKNOWN_RESERVE_ID: '0.0.1103',
  CORE_ACCOUNT_ID: '0.0.3001',
  SETTLEMENT_TOKEN_ID: '0.0.4001',
  HCS_PAYMENTS_TOPIC: '0.0.5001',
  MAX_TX_FEE_HBAR: '2'
};

const env = () => {
  const read = readDemoEnv(ENV);
  if (!read.ok) throw new Error(`test env is missing ${read.data.keys.join(', ')}`);
  return read.data;
};

describe('readDemoEnv', () => {
  it('names the missing keys and never a value', () => {
    const { AGENT_UNKNOWN_PRIVATE_KEY: _dropped, ...rest } = ENV;
    const read = readDemoEnv({ ...rest, SETTLEMENT_TOKEN_ID: 'not an id' });
    expect(read).toEqual({
      ok: false,
      data: { keys: ['SETTLEMENT_TOKEN_ID', 'AGENT_UNKNOWN_PRIVATE_KEY'] }
    });
  });

  it('defaults the demo API ports', () => {
    const data = env();
    expect([data.DEMO_API_IN_PORT, data.DEMO_API_GLOBAL_PORT]).toEqual([4101, 4102]);
  });
});

describe('demoUrls', () => {
  it('points at the local demo APIs by default', () => {
    expect(demoUrls(env())).toEqual({
      gstLookup: 'http://localhost:4101/v1/gst-lookup?gstin=29AAKCK4821M1ZQ',
      company: 'http://localhost:4101/v1/company/U72200KA2016PTC094512',
      lei: 'http://localhost:4102/v1/lei/5493001KQW6DM7KEDR62'
    });
  });

  it('prefers deployed APIs when their URLs are set', () => {
    const urls = demoUrls({
      ...env(),
      DEMO_API_IN_URL: 'https://in.example',
      DEMO_API_GLOBAL_URL: 'https://global.example/'
    });
    expect(urls.company).toBe('https://in.example/v1/company/U72200KA2016PTC094512');
    expect(urls.lei).toBe('https://global.example/v1/lei/5493001KQW6DM7KEDR62');
  });
});

describe('payConfigFor', () => {
  it('pays from the agent into its own reserve, trusting only this Core', () => {
    const config = payConfigFor(env(), 'resident', ['localhost']);
    expect(config).toMatchObject({
      accountId: ACCOUNT,
      reserveAccountId: '0.0.1101',
      trustedFacilitators: ['0.0.3001'],
      policy: { allowlist: ['localhost'] }
    });
    expect(agentKeys(env(), 'unknown').reserveId).toBe('0.0.1103');
  });
});

describe('formatOutcome', () => {
  it('lines up the label, the status and the detail', () => {
    expect(formatOutcome('8b', 'record a challan', { status: 'skipped', detail: '(cut)' })).toBe(
      '[demo]: 8b SKIPPED record a challan: (cut)'
    );
  });
});

describe('currentQuarter', () => {
  it('names the financial-year quarter in IST', () => {
    expect(currentQuarter(new Date('2026-11-07T10:00:00Z'))).toBe('2026-Q3');
    expect(currentQuarter(new Date('2027-02-01T10:00:00Z'))).toBe('2026-Q4');
    expect(currentQuarter(new Date('2027-04-01T00:00:00Z'))).toBe('2027-Q1');
    // 23:30 UTC on 31 March is already 1 April in IST
    expect(currentQuarter(new Date('2027-03-31T23:30:00Z'))).toBe('2027-Q1');
  });
});
