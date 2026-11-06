import { spendPolicySchema } from './spend-policy';
import { type PrivateKey } from '@hiero-ledger/sdk';
import { keyTypeSchema, parsePrivateKey } from '@kosha/hedera/client';
import {
  accountIdSchema,
  type AgentIdentity,
  agentIdentitySchema,
  caip10AccountSchema,
  hederaNetworkSchema,
  tokenIdSchema
} from '@kosha/shared/ids';
import { z } from 'zod';

const HBAR_AMOUNT_PATTERN = /^\d+(\.\d{1,8})?$/;
const DEFAULT_MAX_TX_FEE_HBAR = '2';

export const payConfigSchema = z.strictObject({
  network: hederaNetworkSchema,
  // The agent's paying account and its key. The key never leaves this process and is never logged.
  accountId: accountIdSchema,
  privateKey: z.string().min(1),
  keyType: keyTypeSchema.optional(),
  // The HCS-14 UAID once registered; a Level 0 agent is identified by its account instead
  agentId: agentIdentitySchema.optional(),
  // The agent's own 2-of-2 TDS reserve (Core returns it at registration). Pay refuses any quote
  // whose tds_reserve leg credits another account.
  reserveAccountId: accountIdSchema,
  // SETTLEMENT_TOKEN_ID: the only token Pay will move
  asset: tokenIdSchema,
  // Fee payers (Kosha Core facilitators) Pay will let submit its transactions
  trustedFacilitators: z.array(accountIdSchema).min(1),
  // The most a facilitator may charge as fee payer; mirrors Core's MAX_TX_FEE_HBAR
  maxTransactionFeeHbar: z.string().regex(HBAR_AMOUNT_PATTERN).default(DEFAULT_MAX_TX_FEE_HBAR),
  policy: spendPolicySchema
});

export type PayConfigInput = z.input<typeof payConfigSchema>;
export type PayConfig = Omit<z.output<typeof payConfigSchema>, 'privateKey' | 'agentId'> & {
  privateKey: PrivateKey;
  // What Pay sends in X-KOSHA-AGENT
  agentId: AgentIdentity;
};

export type ParsePayConfigResult =
  | { ok: true; data: PayConfig }
  | { ok: false; data: { reason: 'invalid_config'; issues: string[] } }
  | { ok: false; data: { reason: 'unrecognised_key' | 'ambiguous_raw_key' } };

// Validates createKoshaPay() options and parses the key. Issues name fields, never values.
export const parsePayConfig = (input: unknown): ParsePayConfigResult => {
  const parsed = payConfigSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    return { ok: false, data: { reason: 'invalid_config', issues } };
  }

  const { privateKey, keyType, agentId, ...config } = parsed.data;
  const key = parsePrivateKey(privateKey, keyType);
  if (!key.ok) {
    return key;
  }
  const levelZeroId = caip10AccountSchema.parse(`hedera:${config.network}:${config.accountId}`);
  return {
    ok: true,
    data: { ...config, keyType, privateKey: key.data, agentId: agentId ?? levelZeroId }
  };
};
