import type { EnvValues } from './env-file';
import {
  accountIdSchema,
  type HederaNetwork,
  tokenIdSchema,
  topicIdSchema
} from '@kosha/shared/ids';
import { hashscanAccount, hashscanTopic } from '@kosha/shared/links';

export const TESTNET_ACCOUNTS_DOC = 'docs/testnet-accounts.md';

type Row = { role: string; envKey: string; kind: 'account' | 'token' | 'topic' };

const ROWS: Row[] = [
  { role: 'Core: operator, fee payer, tUSDC treasury', envKey: 'CORE_ACCOUNT_ID', kind: 'account' },
  { role: 'Settlement token', envKey: 'SETTLEMENT_TOKEN_ID', kind: 'token' },
  { role: 'Compliance', envKey: 'COMPLIANCE_ACCOUNT_ID', kind: 'account' },
  { role: 'receiver-in (Indian API owner)', envKey: 'RECEIVER_IN_ACCOUNT_ID', kind: 'account' },
  { role: 'receiver-in-solo', envKey: 'RECEIVER_IN_SOLO_ACCOUNT_ID', kind: 'account' },
  { role: 'receiver-global (foreign API)', envKey: 'RECEIVER_GLOBAL_ACCOUNT_ID', kind: 'account' },
  ...['RESIDENT', 'NONRESIDENT', 'UNKNOWN'].flatMap((name): Row[] => [
    { role: `agent-${name.toLowerCase()}`, envKey: `AGENT_${name}_ACCOUNT_ID`, kind: 'account' },
    {
      role: `agent-${name.toLowerCase()} reserve (2-of-2: agent + Core)`,
      envKey: `AGENT_${name}_RESERVE_ID`,
      kind: 'account'
    }
  ]),
  { role: 'compat-settlement (Core key)', envKey: 'COMPAT_SETTLEMENT_ACCOUNT_ID', kind: 'account' },
  {
    role: 'pool-reserve (2-of-2: Core + compliance)',
    envKey: 'POOL_RESERVE_ACCOUNT_ID',
    kind: 'account'
  },
  { role: 'audit (submit key of the audit topic)', envKey: 'AUDIT_ACCOUNT_ID', kind: 'account' },
  { role: 'HCS payments topic', envKey: 'HCS_PAYMENTS_TOPIC', kind: 'topic' },
  { role: 'HCS profiles topic', envKey: 'HCS_PROFILES_TOPIC', kind: 'topic' },
  { role: 'HCS audit topic', envKey: 'HCS_AUDIT_TOPIC', kind: 'topic' }
];

// Validated at this boundary: a malformed ID becomes "not set" instead of a broken link
const hashscanLink = (network: HederaNetwork, row: Row, value: string): string | null => {
  if (row.kind === 'topic') {
    const topic = topicIdSchema.safeParse(value);
    return topic.success ? hashscanTopic(network, topic.data) : null;
  }
  if (row.kind === 'token') {
    const token = tokenIdSchema.safeParse(value);
    return token.success ? `https://hashscan.io/${network}/token/${token.data}` : null;
  }
  const account = accountIdSchema.safeParse(value);
  return account.success ? hashscanAccount(network, account.data) : null;
};

export type AccountTableRow = {
  role: string;
  envKey: string;
  id: string | null;
  link: string | null;
};

// IDs and links only; private keys never leave the env file
export const accountTable = (network: HederaNetwork, env: EnvValues): AccountTableRow[] =>
  ROWS.map((row) => {
    const value = env[row.envKey]?.trim() ?? '';
    const link = hashscanLink(network, row, value);
    return { role: row.role, envKey: row.envKey, id: link ? value : null, link };
  });

export const accountTableMarkdown = (network: HederaNetwork, rows: AccountTableRow[]): string =>
  [
    '# Testnet accounts',
    '',
    `Written by \`pnpm bootstrap\` (\`scripts/bootstrap.ts\`) on Hedera ${network}. IDs and HashScan`,
    'links only: every private key stays in the shared env file (`../kosha.env`).',
    '',
    '| Role | Env key | ID |',
    '| --- | --- | --- |',
    ...rows.map(
      (row) =>
        `| ${row.role} | \`${row.envKey}\` | ${row.link ? `[${row.id}](${row.link})` : 'not set'} |`
    ),
    ''
  ].join('\n');
