import { type RulePack } from './rule-pack';
import { createHash } from 'node:crypto';

type CanonicalValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue | undefined };

// Canonical JSON: object keys sorted by code unit, no whitespace, undefined keys dropped, and
// bigint written as a plain integer. A parsed pack (bigint paise) and its source file (number
// paise) therefore serialise to the same string.
export const canonicalJson = (value: CanonicalValue): string => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RangeError('[rule-pack-hash]: numbers must be finite');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const entries = Object.entries(value)
    .filter((entry): entry is [string, CanonicalValue] => entry[1] !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
};

// SHA-256 of the canonical pack, as lowercase hex. Core publishes it to HCS when it first loads a
// pack, so anyone can check which rules decided a payment.
export const rulePackHash = (pack: RulePack): string =>
  createHash('sha256').update(canonicalJson(pack)).digest('hex');
