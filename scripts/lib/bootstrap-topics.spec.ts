import { fakeContext, receipt } from './bootstrap-fake';
import { ensureSecrets, ensureTopics, missingSecrets } from './bootstrap-topics';
import { PrivateKey, TopicCreateTransaction } from '@hiero-ledger/sdk';
import { describe, expect, it } from 'vitest';

const AUDIT_KEY = PrivateKey.generateED25519().publicKey;
const EXISTING_AUDIT = { key: AUDIT_KEY, created: false };

const numberedTopics = () => {
  let next = 8000;
  return () => receipt({ topicId: `0.0.${(next += 1)}` });
};

describe('ensureTopics', () => {
  it("creates Kosha's topics with Core as submit key, and the audit topic with the audit key", async () => {
    const context = fakeContext({}, numberedTopics());
    await ensureTopics(context, EXISTING_AUDIT);
    expect(context.saved).toEqual({
      HCS_PAYMENTS_TOPIC: '0.0.8001',
      HCS_PROFILES_TOPIC: '0.0.8002',
      HCS_AUDIT_TOPIC: '0.0.8003'
    });
    const submitKeys = context.transactions.map((create) => {
      if (!(create instanceof TopicCreateTransaction)) throw new Error('expected a topic create');
      return create.getSubmitKey()?.toString();
    });
    const core = context.coreKey.publicKey.toString();
    expect(submitKeys).toEqual([core, core, AUDIT_KEY.toString()]);
  });

  it('replaces an audit topic made before the audit account existed', async () => {
    const context = fakeContext(
      { HCS_PAYMENTS_TOPIC: '0.0.5', HCS_PROFILES_TOPIC: '0.0.6', HCS_AUDIT_TOPIC: '0.0.7' },
      numberedTopics()
    );
    await ensureTopics(context, { key: AUDIT_KEY, created: true });
    expect(context.saved).toEqual({ HCS_AUDIT_TOPIC: '0.0.8001' });
  });

  it('skips topics already in the env file', async () => {
    const context = fakeContext(
      { HCS_PAYMENTS_TOPIC: '0.0.5', HCS_AUDIT_TOPIC: '0.0.6' },
      numberedTopics()
    );
    await ensureTopics(context, EXISTING_AUDIT);
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
