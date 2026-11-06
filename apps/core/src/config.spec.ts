import { loadConfig } from './config';
import { describe, expect, it } from 'vitest';

const ENV = {
  HEDERA_NETWORK: 'testnet',
  CORE_PORT: '4000',
  CORE_ACCOUNT_ID: '0.0.4000',
  RULEPACK_PATH: 'rulepacks/in-2026.2.json'
};

describe('loadConfig', () => {
  it('reads a complete env', () => {
    expect(loadConfig(ENV)).toEqual({
      ok: true,
      data: {
        network: 'testnet',
        port: 4000,
        coreAccountId: '0.0.4000',
        rulePackPath: 'rulepacks/in-2026.2.json'
      }
    });
  });

  it('lists every missing key at once, treating blank values as missing', () => {
    expect(loadConfig({ CORE_PORT: '4000', RULEPACK_PATH: '  ' })).toEqual({
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
    const loaded = loadConfig({ ...ENV, HEDERA_NETWORK: 'previewnet', CORE_PORT: '99999' });
    expect(loaded).toEqual({
      ok: false,
      data: {
        problems: [
          { key: 'HEDERA_NETWORK', problem: 'invalid' },
          { key: 'CORE_PORT', problem: 'invalid' }
        ]
      }
    });
    expect(JSON.stringify(loaded)).not.toContain('previewnet');
  });
});
