import type { z } from 'zod';

// x402 v2 (docs/research/x402.md). Every header and protocol name lives here, so a spec change is
// a one-line change.
export const X402_VERSION = 2;

export const SCHEMES = {
  // Kosha's atomic split: price to payTo and TDS to the payer's own reserve, in one transaction
  koshaSplit: 'kosha-split',
  // The official Hedera scheme, used for compatibility mode
  exact: 'exact'
} as const;

export const X402_NETWORKS = {
  testnet: 'hedera:testnet',
  mainnet: 'hedera:mainnet'
} as const;

export const HEADERS = {
  paymentRequired: 'PAYMENT-REQUIRED',
  paymentSignature: 'PAYMENT-SIGNATURE',
  paymentResponse: 'PAYMENT-RESPONSE',
  // x402 v1, read-only fallback
  legacyPayment: 'X-PAYMENT',
  koshaAgent: 'X-KOSHA-AGENT',
  koshaTax: 'X-KOSHA-TAX'
} as const;

export const CORS_EXPOSED_HEADERS = [
  HEADERS.paymentRequired,
  HEADERS.paymentResponse,
  HEADERS.koshaTax
] as const;
export const CORS_ALLOWED_HEADERS = [
  HEADERS.paymentSignature,
  HEADERS.koshaAgent,
  'Content-Type'
] as const;

export type HeaderDecodeResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      data: { reason: 'not_base64_json' | 'invalid_shape'; issues?: z.core.$ZodIssue[] };
    };

// Header values are base64 (standard alphabet) of UTF-8 JSON
export const encodeHeader = (value: unknown): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
};

export const decodeHeader = <T>(schema: z.ZodType<T>, header: string): HeaderDecodeResult<T> => {
  let json: unknown;
  try {
    const bytes = Uint8Array.from(atob(header), (char) => char.charCodeAt(0));
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, data: { reason: 'not_base64_json' } };
  }
  const parsed = schema.safeParse(json);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, data: { reason: 'invalid_shape', issues: parsed.error.issues } };
};
