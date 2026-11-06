import { AccountId, Client, PrivateKey } from '@hiero-ledger/sdk';
import { accountIdSchema, hederaNetworkSchema } from '@kosha/shared/ids';
import { z } from 'zod';

// DER-encoded private keys, as portal.hedera.com and the SDK's toStringDer() produce them
const DER_PREFIX = { ed25519: '302e', ecdsa: '3030' } as const;
const RAW_HEX_PATTERN = /^(0x)?[0-9a-fA-F]{64}$/;

export const keyTypeSchema = z.enum(['ed25519', 'ecdsa']);
export type KeyType = z.output<typeof keyTypeSchema>;

export type ParsedKey =
  | { ok: true; data: PrivateKey }
  | { ok: false; data: { reason: 'unrecognised_key' | 'ambiguous_raw_key' } };

// Never logs or echoes the key. A raw 32-byte hex key is ambiguous (it could be either curve), so
// it needs an explicit key type unless it carries the 0x prefix the portal uses for ECDSA.
export const parsePrivateKey = (text: string, keyType?: KeyType): ParsedKey => {
  const key = text.trim();
  try {
    if (key.startsWith(DER_PREFIX.ed25519) || key.startsWith(DER_PREFIX.ecdsa)) {
      return { ok: true, data: PrivateKey.fromStringDer(key) };
    }
    if (!RAW_HEX_PATTERN.test(key)) return { ok: false, data: { reason: 'unrecognised_key' } };
    const type = keyType ?? (key.startsWith('0x') ? 'ecdsa' : undefined);
    if (!type) return { ok: false, data: { reason: 'ambiguous_raw_key' } };
    const parsed =
      type === 'ecdsa' ? PrivateKey.fromStringECDSA(key) : PrivateKey.fromStringED25519(key);
    return { ok: true, data: parsed };
  } catch {
    return { ok: false, data: { reason: 'unrecognised_key' } };
  }
};

export const clientConfigSchema = z.object({
  network: hederaNetworkSchema,
  operatorId: accountIdSchema,
  privateKey: z.string().min(1),
  keyType: keyTypeSchema.optional()
});
// Raw strings (usually from env); buildClient validates them
export type ClientConfig = {
  network: string;
  operatorId: string;
  privateKey: string;
  keyType?: string;
};

export type BuiltClient =
  | { ok: true; data: { client: Client; operatorId: AccountId; operatorKey: PrivateKey } }
  | {
      ok: false;
      data: {
        reason: 'invalid_config' | 'unrecognised_key' | 'ambiguous_raw_key';
        fields?: string[];
      };
    };

export const buildClient = (config: ClientConfig): BuiltClient => {
  const parsed = clientConfigSchema.safeParse(config);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.'));
    return { ok: false, data: { reason: 'invalid_config', fields } };
  }
  const { network, operatorId, privateKey, keyType } = parsed.data;
  const key = parsePrivateKey(privateKey, keyType);
  if (!key.ok) return key;

  const accountId = AccountId.fromString(operatorId);
  const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(accountId, key.data);
  return { ok: true, data: { client, operatorId: accountId, operatorKey: key.data } };
};

// Core's operator (fee payer and facilitator) from the shared env file
export const coreClientFromEnv = (env: NodeJS.ProcessEnv = process.env): BuiltClient =>
  buildClient({
    network: env.HEDERA_NETWORK ?? '',
    operatorId: env.CORE_ACCOUNT_ID ?? '',
    privateKey: env.CORE_PRIVATE_KEY ?? ''
  });
