import type { MirrorAccountKey, MirrorClient } from './mirror';
import { PublicKey } from '@hiero-ledger/sdk';

// The payer's public key, from the Mirror Node, for checking its signature on a settlement.
// Kosha's payers sign with one key; a key list (ProtobufEncoded) is refused.

export type PayerKeyResult =
  | { ok: true; data: PublicKey }
  | { ok: false; data: { reason: 'unavailable' | 'unsupported_key' } };

export const publicKeyFromMirror = (key: MirrorAccountKey): PublicKey | null => {
  try {
    if (key.type === 'ED25519') return PublicKey.fromStringED25519(key.hex);
    if (key.type === 'ECDSA_SECP256K1') return PublicKey.fromStringECDSA(key.hex);
    return null;
  } catch {
    return null;
  }
};

export const mirrorPayerKey =
  (mirror: Pick<MirrorClient, 'accountKey'>) =>
  async (accountId: string): Promise<PayerKeyResult> => {
    const key = await mirror.accountKey(accountId);
    if (!key.ok) {
      // An unknown or keyless account can't have signed anything
      const reason = key.data.reason === 'http_error' ? 'unavailable' : 'unsupported_key';
      return { ok: false, data: { reason } };
    }
    const publicKey = publicKeyFromMirror(key.data);
    return publicKey
      ? { ok: true, data: publicKey }
      : { ok: false, data: { reason: 'unsupported_key' } };
  };

export type PayerKeyLookup = ReturnType<typeof mirrorPayerKey>;
