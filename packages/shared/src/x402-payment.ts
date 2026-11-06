import { SCHEMES, X402_NETWORKS, X402_VERSION } from './headers';
import { accountIdSchema, quoteIdSchema, tokenIdSchema, transactionIdSchema } from './ids';
import { amountSchema } from './money';
import { z } from 'zod';

// Hedera's transaction valid duration is 180 s, so a quote can never outlive it
const MAX_TIMEOUT_SECONDS = 180;
const MAX_BPS = 10_000;
export const QUOTE_MEMO_PREFIX = 'kosha:';

export const quoteMemo = (quoteId: string): string => `${QUOTE_MEMO_PREFIX}${quoteId}`;

export const x402NetworkSchema = z.enum([X402_NETWORKS.testnet, X402_NETWORKS.mainnet]);

export const resourceSchema = z.object({
  url: z.url(),
  description: z.string().optional(),
  mimeType: z.string().optional()
});

export const TAX_REASONS = [
  'under_threshold',
  'within_tolerance',
  'threshold_crossed',
  'tolerance_exceeded',
  'first_rupee',
  'non_resident',
  'receiver_non_resident'
] as const;
export const taxReasonSchema = z.enum(TAX_REASONS);
export const taxFlagSchema = z.enum(['fema_review']);
export const transferLegSchema = z.enum(['consideration', 'tds_reserve']);

export const quoteTransferSchema = z.object({
  account: accountIdSchema,
  amount: amountSchema,
  leg: transferLegSchema
});

export const quoteTaxSchema = z.object({
  rulepack: z.string().min(1),
  rateBps: z.int().min(0).max(MAX_BPS),
  inrValuePaise: amountSchema,
  tdsMicroUsdc: amountSchema,
  funding: z.literal('payer_reserve'),
  reason: taxReasonSchema,
  flags: z.array(taxFlagSchema)
});

const requirementBase = {
  network: x402NetworkSchema,
  asset: tokenIdSchema,
  payTo: accountIdSchema,
  // The net credit to payTo, as the official exact scheme defines it
  amount: amountSchema,
  maxTimeoutSeconds: z.int().min(1).max(MAX_TIMEOUT_SECONDS)
};

export const koshaSplitRequirementsSchema = z.object({
  ...requirementBase,
  scheme: z.literal(SCHEMES.koshaSplit),
  extra: z.object({
    feePayer: accountIdSchema,
    kosha: z.object({
      quoteId: quoteIdSchema,
      memo: z.string().max(100),
      expiresAt: z.iso.datetime(),
      nodeAccountIds: z.array(accountIdSchema).min(1),
      totalMicro: amountSchema,
      transfers: z.array(quoteTransferSchema).min(1),
      tax: quoteTaxSchema,
      // Present for unverified payers: how to reach Level 1 and drop from 20% to 1%
      register: z.url().optional()
    })
  })
});

export const exactRequirementsSchema = z.object({
  ...requirementBase,
  scheme: z.literal(SCHEMES.exact),
  extra: z.object({
    feePayer: accountIdSchema,
    kosha: z.object({ quoteId: quoteIdSchema, mode: z.literal('compat') }).optional()
  })
});

export const paymentRequirementsSchema = z.discriminatedUnion('scheme', [
  koshaSplitRequirementsSchema,
  exactRequirementsSchema
]);

export type KoshaSplitRequirements = z.output<typeof koshaSplitRequirementsSchema>;
export type ExactRequirements = z.output<typeof exactRequirementsSchema>;
export type PaymentRequirements = z.output<typeof paymentRequirementsSchema>;
export type QuoteTransfer = z.output<typeof quoteTransferSchema>;
export type QuoteTax = z.output<typeof quoteTaxSchema>;
export type TaxReason = z.output<typeof taxReasonSchema>;

export const paymentRequiredSchema = z.object({
  x402Version: z.literal(X402_VERSION),
  error: z.string().optional(),
  resource: resourceSchema,
  accepts: z.array(paymentRequirementsSchema).min(1),
  extensions: z.record(z.string(), z.unknown()).optional()
});
export type PaymentRequired = z.output<typeof paymentRequiredSchema>;

// A 402 as a client reads it: a server may also offer schemes or networks Kosha doesn't model
// (an eip155 or `upto` entry). Those entries are dropped rather than failing the whole 402, and it
// is refused only when no entry is left. Servers build theirs with paymentRequiredSchema.
export const offeredPaymentRequiredSchema = paymentRequiredSchema.extend({
  accepts: z
    .array(z.unknown())
    .transform((entries) =>
      entries.flatMap((entry) => {
        const parsed = paymentRequirementsSchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      })
    )
    .refine((entries) => entries.length > 0, 'no accepts entry Kosha can pay')
});

// Sent in PAYMENT-SIGNATURE. `accepted` echoes the chosen accepts[] entry.
export const paymentPayloadSchema = z.object({
  x402Version: z.literal(X402_VERSION),
  resource: resourceSchema.optional(),
  accepted: paymentRequirementsSchema,
  payload: z.object({
    // The frozen, payer-signed TransferTransaction bytes
    transaction: z.base64()
  })
});
export type PaymentPayload = z.output<typeof paymentPayloadSchema>;

// Sent in PAYMENT-RESPONSE, on success and on a failed settlement
export const settlementResponseSchema = z.object({
  success: z.boolean(),
  errorReason: z.string().optional(),
  errorMessage: z.string().optional(),
  payer: accountIdSchema.optional(),
  transaction: z.union([transactionIdSchema, z.literal('')]),
  network: x402NetworkSchema,
  amount: amountSchema.optional(),
  extensions: z
    .object({
      kosha: z.object({
        hashscanUrl: z.url(),
        // null until the HCS outbox has published the record
        hcsSequence: z.int().positive().nullable(),
        tdsMicroUsdc: amountSchema,
        // The quoted API price: a resent payment's earlier result must not serve a dearer route
        priceMicroUsdc: amountSchema.optional()
      })
    })
    .optional()
});
export type SettlementResponse = z.output<typeof settlementResponseSchema>;
