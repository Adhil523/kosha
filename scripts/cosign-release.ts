import { coreHttp } from './seed';
import { AccountId, ScheduleSignTransaction, TransactionId } from '@hiero-ledger/sdk';
import { parsePrivateKey } from '@kosha/hedera/client';
import { loadEnv } from '@kosha/shared/env';
import { accountIdSchema, hederaNetworkSchema } from '@kosha/shared/ids';
import { hashscanSchedule } from '@kosha/shared/links';
import { formatUsdc } from '@kosha/shared/money';
import { agentRowSchema } from '@kosha/shared/registry';
import { releaseRowSchema } from '@kosha/shared/tax-reports';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// `pnpm cosign-release --release <rel_…>` (A20): the agent operator's half of a reserve release.
// Core scheduled the transfer (reserve → deductor) and signed it; this script signs a
// ScheduleSignTransaction with the demo agent's key and hands it to Core, which relays it. With
// both keys of the 2-of-2 reserve the transfer runs at once. Stands in for HashPack in the demo.

// The three settlement nodes Core quotes; a ScheduleSign may go to any of them
const NODE_ACCOUNT_IDS = ['0.0.3', '0.0.4', '0.0.5'];
const POLL_ATTEMPTS = 8;
const POLL_DELAY_MS = 2_500;

const envSchema = z.object({
  HEDERA_NETWORK: hederaNetworkSchema,
  CORE_URL: z.url(),
  CONSOLE_ADMIN_TOKEN: z.string().min(32),
  AGENT_RESIDENT_ACCOUNT_ID: accountIdSchema,
  AGENT_RESIDENT_PRIVATE_KEY: z.string().min(1),
  AGENT_NONRESIDENT_ACCOUNT_ID: accountIdSchema,
  AGENT_NONRESIDENT_PRIVATE_KEY: z.string().min(1),
  AGENT_UNKNOWN_ACCOUNT_ID: accountIdSchema,
  AGENT_UNKNOWN_PRIVATE_KEY: z.string().min(1)
});
type SignerEnv = Record<
  | 'AGENT_RESIDENT_ACCOUNT_ID'
  | 'AGENT_RESIDENT_PRIVATE_KEY'
  | 'AGENT_NONRESIDENT_ACCOUNT_ID'
  | 'AGENT_NONRESIDENT_PRIVATE_KEY'
  | 'AGENT_UNKNOWN_ACCOUNT_ID'
  | 'AGENT_UNKNOWN_PRIVATE_KEY',
  string
>;

export const releaseArgument = (args: string[]): string | null => {
  const index = args.indexOf('--release');
  return index >= 0 ? (args[index + 1] ?? null) : null;
};

// The demo agent whose account backs the release's agent identity, with its key
export const demoSigner = (
  env: SignerEnv,
  identity: string
): { accountId: string; privateKey: string } | null => {
  const account = identity.split(':').at(-1) ?? '';
  const signers = [
    { accountId: env.AGENT_RESIDENT_ACCOUNT_ID, privateKey: env.AGENT_RESIDENT_PRIVATE_KEY },
    {
      accountId: env.AGENT_NONRESIDENT_ACCOUNT_ID,
      privateKey: env.AGENT_NONRESIDENT_PRIVATE_KEY
    },
    { accountId: env.AGENT_UNKNOWN_ACCOUNT_ID, privateKey: env.AGENT_UNKNOWN_PRIVATE_KEY }
  ];
  return signers.find((signer) => signer.accountId === account) ?? null;
};

// Frozen with the agent as payer and signed by its key, so Core relays it unchanged
export const signedScheduleSign = async (
  scheduleId: string,
  signer: { accountId: string; privateKey: string }
): Promise<string> => {
  const key = parsePrivateKey(signer.privateKey);
  if (!key.ok) throw new Error(`[cosign-release]: the key for ${signer.accountId} is not usable`);
  const transaction = new ScheduleSignTransaction()
    .setScheduleId(scheduleId)
    .setTransactionId(TransactionId.generate(AccountId.fromString(signer.accountId)))
    .setNodeAccountIds(NODE_ACCOUNT_IDS.map((id) => AccountId.fromString(id)))
    .freeze();
  await transaction.sign(key.data);
  return Buffer.from(transaction.toBytes()).toString('base64');
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async (): Promise<void> => {
  const loaded = loadEnv();
  if (!loaded.ok) throw new Error(`no pnpm workspace found above ${loaded.data.searchedFrom}`);
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
    throw new Error(`set these env keys (pnpm bootstrap, then pnpm seed --profiles): ${keys}`);
  }
  const env = parsed.data;
  const releaseId = releaseArgument(process.argv.slice(2));
  if (!releaseId) throw new Error('usage: pnpm cosign-release --release <rel_…>');

  const core = coreHttp(env.CORE_URL, env.CONSOLE_ADMIN_TOKEN);
  const listed = await core('GET', '/v1/releases');
  const release = z
    .array(releaseRowSchema)
    .parse(listed.body)
    .find((row) => row.id === releaseId);
  if (!release) throw new Error(`no release ${releaseId}; GET /v1/releases lists them`);
  if (release.status !== 'scheduled' || !release.scheduleId) {
    throw new Error(`release ${releaseId} is ${release.status}, not awaiting a co-sign`);
  }

  const agents = z.array(agentRowSchema).parse((await core('GET', '/v1/agents')).body);
  const agent = agents.find((row) => row.agentId === release.agentId);
  const signer = agent ? demoSigner(env, agent.identity) : null;
  if (!agent || !signer) {
    throw new Error(`no demo key for the agent behind ${releaseId}; it is not a seeded agent`);
  }

  console.info(
    `[cosign-release]: ${formatUsdc(BigInt(release.micro))} from reserve ${release.reserveAccountId}, schedule ${release.scheduleId}, signed by ${signer.accountId}`
  );
  const answered = await core('POST', `/v1/releases/${releaseId}/cosign`, {
    transaction: await signedScheduleSign(release.scheduleId, signer)
  });
  if (answered.status !== 200) {
    throw new Error(
      `Core refused the co-sign: ${answered.status} ${JSON.stringify(answered.body)}`
    );
  }

  let current = releaseRowSchema.parse(answered.body);
  for (let attempt = 0; current.status === 'scheduled' && attempt < POLL_ATTEMPTS; attempt += 1) {
    await sleep(POLL_DELAY_MS);
    const rows = z.array(releaseRowSchema).parse((await core('GET', '/v1/releases')).body);
    current = rows.find((row) => row.id === releaseId) ?? current;
  }
  console.info(`[cosign-release]: release ${releaseId} is ${current.status}`);
  console.info(`[cosign-release]: ${hashscanSchedule(env.HEDERA_NETWORK, release.scheduleId)}`);
};

const invokedDirectly =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) void main();
