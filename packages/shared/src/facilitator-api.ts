import { errorCodeSchema } from './error-codes';
import { SCHEMES, X402_VERSION } from './headers';
import { accountIdSchema, agentIdentitySchema, quoteIdSchema } from './ids';
import { amountSchema } from './money';
import {
  paymentPayloadSchema,
  paymentRequiredSchema,
  paymentRequirementsSchema,
  resourceSchema,
  settlementResponseSchema,
  taxFlagSchema,
  taxReasonSchema,
  x402NetworkSchema
} from './x402-payment';
import { z } from 'zod';

const MAX_BPS = 10_000;

export const residencySchema = z.enum(['resident', 'non_resident']);
// A payer with no verified profile is "unknown" until it reaches Level 1
export const payerResidencySchema = z.enum(['resident', 'non_resident', 'unknown']);
export type Residency = z.output<typeof residencySchema>;
export type PayerResidency = z.output<typeof payerResidencySchema>;

// POST /v1/quote (Gate → Core). The price is the API's net price; Core adds the tax.
export const quoteRequestSchema = z.object({
  method: z.string().regex(/^[A-Z]+$/),
  resource: resourceSchema,
  priceMicroUsdc: amountSchema,
  // X-KOSHA-AGENT, when the caller sent one
  agent: agentIdentitySchema.optional()
});
export const quoteResponseSchema = paymentRequiredSchema;

// POST /v1/verify and POST /v1/settle take the same x402 v2 body
export const facilitatorRequestSchema = z.object({
  x402Version: z.literal(X402_VERSION),
  paymentPayload: paymentPayloadSchema,
  paymentRequirements: paymentRequirementsSchema
});

export const verifyResponseSchema = z.object({
  isValid: z.boolean(),
  invalidReason: z.string().optional(),
  invalidMessage: z.string().optional(),
  payer: accountIdSchema.optional(),
  extra: z
    .object({ kosha: z.object({ quoteId: quoteIdSchema, errorCode: errorCodeSchema.optional() }) })
    .optional()
});
export const settleResponseSchema = settlementResponseSchema;

// GET /v1/supported
export const supportedResponseSchema = z.object({
  kinds: z.array(
    z.object({
      x402Version: z.literal(X402_VERSION),
      scheme: z.enum([SCHEMES.koshaSplit, SCHEMES.exact]),
      network: x402NetworkSchema,
      extra: z.object({ feePayer: accountIdSchema })
    })
  ),
  extensions: z.array(z.string()),
  signers: z.record(z.string(), z.array(accountIdSchema)),
  kosha: z.object({
    rulepack: z.object({
      id: z.string().min(1),
      // SHA-256 of the canonical rule pack, as published to HCS
      hash: z.string().regex(/^[0-9a-f]{64}$/),
      reviewedBy: z.string().nullable()
    })
  })
});

// POST /v1/decide: Kosha's tax decision for a payment settled on any rail
export const decideRequestSchema = z.object({
  payer: z.union([
    z.object({ identity: agentIdentitySchema }),
    // A facilitator that keeps its own payer profiles sends claims and its own reference
    z.object({
      claims: z.object({ residency: payerResidencySchema, panOnFile: z.boolean() }),
      reference: z.string().min(1)
    })
  ]),
  priceMicroUsdc: amountSchema,
  inrPerUsdMicro: amountSchema.optional(),
  // e.g. "hedera:testnet" or "eip155:8453"
  chain: z.string().min(1),
  resource: z.url().optional()
});

export const decideResponseSchema = z.object({
  decisionId: z.string().min(1),
  rulepack: z.string().min(1),
  rateBps: z.int().min(0).max(MAX_BPS),
  valuePaise: amountSchema,
  tdsPaise: amountSchema,
  tdsMicroUsdc: amountSchema,
  reason: taxReasonSchema,
  flags: z.array(taxFlagSchema),
  hcsSequence: z.int().positive().nullable()
});

// POST /v1/decisions/:id/confirm, once the payment has settled on its rail
export const decisionConfirmSchema = z.object({
  chain: z.string().min(1),
  transactionRef: z.string().min(1)
});

export type QuoteRequest = z.output<typeof quoteRequestSchema>;
export type FacilitatorRequest = z.output<typeof facilitatorRequestSchema>;
export type VerifyResponse = z.output<typeof verifyResponseSchema>;
export type SupportedResponse = z.output<typeof supportedResponseSchema>;
export type DecideRequest = z.output<typeof decideRequestSchema>;
export type DecideResponse = z.output<typeof decideResponseSchema>;
export type DecisionConfirm = z.output<typeof decisionConfirmSchema>;
