import { fakeContext, receipt } from './bootstrap-fake';
import { ensureSecrets, ensureTopics, missingSecrets } from './bootstrap-topics';
import { PrivateKey, TopicCreateTransaction } from '@hiero-ledger/sdk';
import { describe, expect, it } from 'vitest';

const numberedTopics = () => {
  let next = 8000;
  return () => receipt({ topicId: `0.0.${(next += 1)}` });
};

describe('ensureTopics', () => {
  it('creates the three topics with Core as submit key', async () => {
    const context = fakeContext({}, numberedTopics());
    await ensureTopics(context);
    expect(context.saved).toEqual({
      HCS_PAYMENTS_TOPIC: '0.0.8001',
      HCS_PROFILES_TOPIC: '0.0.8002',
      HCS_AUDIT_TOPIC: '0.0.8003'
    });
    for (const create of context.transactions) {
      if (!(create instanceof TopicCreateTransaction)) throw new Error('expected a topic create');
      expect(create.getSubmitKey()?.toString()).toBe(context.coreKey.publicKey.toString());
    }
  });

  it('skips topics already in the env file', async () => {
    const context = fakeContext(
      { HCS_PAYMENTS_TOPIC: '0.0.5', HCS_AUDIT_TOPIC: '0.0.6' },
      numberedTopics()
    );
    await ensureTopics(context);
    expect(context.saved).toEqual({ HCS_PROFILES_TOPIC: '0.0.8001' });
  });
});

describe('missingSecrets', () => {
  it('generates 32-byte hex secrets and a DER Ed25519 issuer key', () => {
    const secrets = missingSecrets({});
    expect(Object.keys(secrets)).toHaveLength(6);
    expect(secrets.CONSOLE_ADMIN_TOKEN).toMatch(/^[0-9a-f]{64}$/);
    expect(secrets.DEMO_API_IN_KEY).not.toBe(secrets.DEMO_API_GLOBAL_KEY);
    const issuer = secrets.ISSUER_PRIVATE_KEY ?? '';
    expect(PrivateKey.fromStringDer(issuer).type).toBe('ED25519');
  });

  it('never replaces a secret already set', () => {
    const context = fakeContext({ CONSOLE_ADMIN_TOKEN: 'in-use' }, numberedTopics());
    ensureSecrets(context);
    expect(context.saved.CONSOLE_ADMIN_TOKEN).toBeUndefined();
    expect(context.env.CONSOLE_ADMIN_TOKEN).toBe('in-use');
    expect(Object.keys(context.saved)).toHaveLength(5);
  });
});
