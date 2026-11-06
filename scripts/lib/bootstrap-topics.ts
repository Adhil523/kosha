import { type BootstrapContext, bootstrapLog } from './bootstrap-context';
import { PrivateKey, type PublicKey, TopicCreateTransaction } from '@hiero-ledger/sdk';
import { randomBytes } from 'node:crypto';

const TOPICS = [
  { envKey: 'HCS_PAYMENTS_TOPIC', memo: 'kosha payments', submitter: 'core' },
  { envKey: 'HCS_PROFILES_TOPIC', memo: 'kosha profiles', submitter: 'core' },
  { envKey: 'HCS_AUDIT_TOPIC', memo: 'kosha audit', submitter: 'audit' }
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

// Core is the submit key on Kosha's own topics, so nobody else can post to the tamper-evident log.
// The audit topic takes the audit account's key instead, so the demo agent never holds Core's key.
// An audit topic made before the audit account existed has Core as submit key, so the run that
// creates the audit account replaces it.
export const ensureTopics = async (
  context: BootstrapContext,
  audit: { key: PublicKey; created: boolean }
): Promise<void> => {
  for (const { envKey, memo, submitter } of TOPICS) {
    const replace = submitter === 'audit' && audit.created;
    if (context.env[envKey]?.trim() && !replace) continue;
    const create = new TopicCreateTransaction()
      .setSubmitKey(submitter === 'audit' ? audit.key : context.coreKey.publicKey)
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
