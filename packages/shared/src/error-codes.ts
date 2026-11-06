import { z } from 'zod';

// Every error Core returns as { error: ErrorCode } and Gate puts in a failed 402
export const ERROR_CODES = [
  // Verifier: the signed transaction against its quote
  'not_transfer',
  'wrong_fee_payer',
  'memo_mismatch',
  'wrong_nodes',
  'fee_too_high',
  'valid_start_out_of_window',
  'hbar_movement',
  'nft_transfer',
  'approved_transfer',
  'wrong_token',
  'token_count',
  'transfer_count',
  'multiple_debits',
  'amount_mismatch',
  'reserve_not_payers',
  // The fee payer's own account moves tokens (compatibility mode: the payer must be someone else)
  'fee_payer_transferring',
  'bad_signature',
  // Quote lifecycle
  'quote_not_found',
  'quote_expired',
  'replay',
  // Settlement: the network rejected the transaction, or its outcome is not yet known (it may
  // still settle; Core never resubmits it)
  'settlement_failed',
  'settlement_pending',
  // Profiles
  'unknown_receiver',
  'payer_not_declared',
  // Spending policy (Core re-checks what Kosha Pay checks)
  'policy_per_payment',
  'policy_daily',
  'policy_budget',
  'policy_allowlist',
  'policy_threshold_block',
  // Request and transport
  'invalid_payload',
  'unsupported_scheme',
  'unauthorized',
  'not_found',
  'internal_error',
  'core_unavailable'
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.output<typeof errorCodeSchema>;

export const errorResponseSchema = z.object({
  error: errorCodeSchema,
  message: z.string().optional()
});
export type ErrorResponse = z.output<typeof errorResponseSchema>;

// Standard x402 reasons (docs/research/x402.md) for codes that have a direct equivalent. Verify
// puts these in invalidReason and the Kosha code in extra.kosha.errorCode; a failed settle puts
// the Kosha code itself in errorReason (docs/core-api.md).
const HEDERA_REASON_PREFIX = 'invalid_exact_hedera_payload_';
const X402_REASON_BY_CODE = new Map<ErrorCode, string>([
  ['not_transfer', `${HEDERA_REASON_PREFIX}contains_non_transfer_ops`],
  ['wrong_fee_payer', `${HEDERA_REASON_PREFIX}fee_payer_mismatch`],
  ['wrong_token', `${HEDERA_REASON_PREFIX}asset_mismatch`],
  ['amount_mismatch', `${HEDERA_REASON_PREFIX}amount_mismatch`],
  ['bad_signature', `${HEDERA_REASON_PREFIX}signature_invalid`],
  ['fee_payer_transferring', `${HEDERA_REASON_PREFIX}fee_payer_transferring_funds`],
  ['unsupported_scheme', 'unsupported_scheme']
]);
const DEFAULT_X402_REASON = 'invalid_payload';

export const toX402Reason = (code: ErrorCode): string =>
  X402_REASON_BY_CODE.get(code) ?? DEFAULT_X402_REASON;
