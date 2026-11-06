import { loadConfig } from './config';
import { describe, expect, it } from 'vitest';

const SECRET = 'f'.repeat(64);
const ENV = {
  HEDERA_NETWORK: 'testnet',
  CORE_PORT: '4000',
  CORE_ACCOUNT_ID: '0.0.4000',
  CORE_PRIVATE_KEY: '302e020100300506032b657004220420' + 'a'.repeat(64),
  RULEPACK_PATH: 'rulepacks/in-2026.2.json',
  DATABASE_URL: 'postgres://postgres:kosha@localhost:5432/kosha_a',
  MIRROR_URL: 'https://testnet.mirrornode.hedera.com',
  SETTLEMENT_TOKEN_ID: '0.0.7000',
  HCS_PAYMENTS_TOPIC: '0.0.7100',
  COMPAT_SETTLEMENT_ACCOUNT_ID: '0.0.4200',
  POOL_RESERVE_ACCOUNT_ID: '0.0.4300',
  MAX_TX_FEE_HBAR: '2',
  FX_DEMO_INR_PER_USD: '88.40',
  PAIR_HMAC_SECRET: SECRET,
  PAN_COMMIT_SECRET: SECRET,
  CONSOLE_ADMIN_TOKEN: SECRET,
  ISSUER_PRIVATE_KEY: '302e020100300506032b657004220420' + 'b'.repeat(64)
};

describe('loadConfig', () => {
  it('reads a complete env', () => {
    expect(loadConfig(ENV)).toEqual({
      ok: true,
      data: {
        network: 'testnet',
        port: 4000,
        coreAccountId: '0.0.4000',
        corePrivateKey: ENV.CORE_PRIVATE_KEY,
        rulePackPath: 'rulepacks/in-2026.2.json',
        databaseUrl: ENV.DATABASE_URL,
        mirrorUrl: ENV.MIRROR_URL,
        settlementTokenId: '0.0.7000',
        paymentsTopicId: '0.0.7100',
        compatSettlementAccountId: '0.0.4200',
        poolReserveAccountId: '0.0.4300',
        maxTxFeeHbar: '2',
        fxInrPerUsd: '88.40',
        pairHmacSecret: SECRET,
        panCommitSecret: SECRET,
        adminToken: SECRET,
        issuerPrivateKey: ENV.ISSUER_PRIVATE_KEY
      }
    });
  });

  it('lists every missing key at once, treating blank values as missing', () => {
    const { HEDERA_NETWORK: _network, CORE_ACCOUNT_ID: _account, ...rest } = ENV;
    expect(loadConfig({ ...rest, RULEPACK_PATH: '  ' })).toEqual({
      ok: false,
      data: {
        problems: [
          { key: 'HEDERA_NETWORK', problem: 'missing' },
          { key: 'CORE_ACCOUNT_ID', problem: 'missing' },
          { key: 'RULEPACK_PATH', problem: 'missing' }
        ]
      }
    });
  });

  it('names invalid keys without echoing their values', () => {
    const loaded = loadConfig({
      ...ENV,
      HEDERA_NETWORK: 'previewnet',
      CORE_PORT: '99999',
      PAIR_HMAC_SECRET: 'short'
    });
    expect(loaded).toEqual({
      ok: false,
      data: {
        problems: [
          { key: 'HEDERA_NETWORK', problem: 'invalid' },
          { key: 'CORE_PORT', problem: 'invalid' },
          { key: 'PAIR_HMAC_SECRET', problem: 'invalid' }
        ]
      }
    });
    expect(JSON.stringify(loaded)).not.toContain('previewnet');
  });
});
