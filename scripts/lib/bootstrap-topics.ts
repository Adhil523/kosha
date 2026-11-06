import { type BootstrapContext, bootstrapLog } from './bootstrap-context';
import { PrivateKey, TopicCreateTransaction } from '@hiero-ledger/sdk';
import { randomBytes } from 'node:crypto';

const TOPICS = [
  { envKey: 'HCS_PAYMENTS_TOPIC', memo: 'kosha payments' },
  { envKey: 'HCS_PROFILES_TOPIC', memo: 'kosha profiles' },
  { envKey: 'HCS_AUDIT_TOPIC', memo: 'kosha audit' }
] as const;

// Same shape as Core's generateApiKey(): 32 random bytes, hex
const HEX_SECRET_KEYS = [
  'PAIR_HMAC_SECRET',
  'PAN_COMMIT_SECRET',
  'CONSOLE_ADMIN_TOKEN',
  'DEMO_API_IN_KEY',
  'DEMO_API_GLOBAL_KEY'
] as const;
const SECRET_BYTES = 32;
// Core's test credential issuer signs with an Ed25519 key, stored DER-encoded
const ISSUER_KEY = 'ISSUER_PRIVATE_KEY';

// Core is the submit key on every topic, so nobody else can post to the tamper-evident log
export const ensureTopics = async (context: BootstrapContext): Promise<void> => {
  for (const { envKey, memo } of TOPICS) {
    if (context.env[envKey]?.trim()) continue;
    const create = new TopicCreateTransaction()
      .setSubmitKey(context.coreKey.publicKey)
      .setTopicMemo(memo);
    const created = await context.run(create);
    if (!created.ok) throw new Error(`creating ${memo} topic failed: ${created.data.status}`);
    const topicId = created.data.topicId?.toString();
    if (!topicId) throw new Error(`creating ${memo} topic returned no topic ID`);
    context.save({ [envKey]: topicId });
  }
  bootstrapLog('topics ready');
};

// Generates only the secrets the env file lacks; a rerun never rotates a secret in use
export const missingSecrets = (env: BootstrapContext['env']): Record<string, string> => {
  const generated: Record<string, string> = {};
  for (const key of HEX_SECRET_KEYS) {
    if (!env[key]?.trim()) generated[key] = randomBytes(SECRET_BYTES).toString('hex');
  }
  if (!env[ISSUER_KEY]?.trim()) generated[ISSUER_KEY] = PrivateKey.generateED25519().toStringDer();
  return generated;
};

export const ensureSecrets = (context: BootstrapContext): void => {
  const generated = missingSecrets(context.env);
  if (Object.keys(generated).length === 0) return bootstrapLog('secrets already set');
  context.save(generated);
};
