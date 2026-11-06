import { pickDemoSigner } from '@/lib/demo-signer';
import { describe, expect, it } from 'vitest';

const ENV = {
  AGENT_RESIDENT_ACCOUNT_ID: '0.0.6001',
  AGENT_RESIDENT_PRIVATE_KEY: 'resident-key',
  AGENT_UNKNOWN_ACCOUNT_ID: '0.0.6003',
  AGENT_UNKNOWN_PRIVATE_KEY: 'unknown-key'
};

describe('pickDemoSigner', () => {
  it('finds the seeded agent behind a declared wallet', () => {
    expect(pickDemoSigner(ENV, ['0.0.7000', '0.0.6003'])).toEqual({
      accountId: '0.0.6003',
      privateKey: 'unknown-key'
    });
  });

  it('has no key for an agent that is not seeded', () => {
    expect(pickDemoSigner(ENV, ['0.0.7000'])).toBeNull();
  });

  it('skips a seeded agent whose key is missing', () => {
    expect(pickDemoSigner({ AGENT_RESIDENT_ACCOUNT_ID: '0.0.6001' }, ['0.0.6001'])).toBeNull();
  });
});
