import { type Uaid, uaidSchema } from '@kosha/shared/ids';
import { createHash } from 'node:crypto';

// An HCS-14 Universal Agent ID of the `aid` kind (docs/research/hcs-14.md): the base58 SHA-384 of
// the agent's canonical identity record, with the routing parameters after it. Computed offline,
// no registry, no fee. On Hedera it resolves through the account named in `nativeId`, whose
// HCS-11 profile must carry this same `uaid`.

export type UaidRecord = {
  registry: string;
  name: string;
  version: string;
  protocol: string;
  // CAIP-10, e.g. hedera:testnet:0.0.6001
  nativeId: string;
  skills: number[];
};

export type UaidParams = { uid: string };

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE = 58n;

// Bitcoin-alphabet base58, leading zero bytes as leading '1's
export const toBase58 = (bytes: Uint8Array): string => {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = '';
  while (value > 0n) {
    encoded = BASE58_ALPHABET[Number(value % BASE)] + encoded;
    value /= BASE;
  }
  let leadingZeros = 0;
  for (const byte of bytes) {
    if (byte !== 0) break;
    leadingZeros += 1;
  }
  return '1'.repeat(leadingZeros) + encoded;
};

// JSON with the keys in sorted order and no whitespace (RFC 8785 for these flat records)
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

export const uaidHash = (record: UaidRecord): string =>
  toBase58(createHash('sha384').update(canonical(record)).digest());

// uaid:aid:<hash>;uid=0;registry=kosha;proto=hcs-10;nativeId=hedera:testnet:0.0.x
export const createUaid = (record: UaidRecord, params: UaidParams): Uaid =>
  uaidSchema.parse(
    `uaid:aid:${uaidHash(record)};uid=${params.uid};registry=${record.registry};proto=${record.protocol};nativeId=${record.nativeId}`
  );
