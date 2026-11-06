import { payerResidencySchema } from './facilitator-api';
import { accountIdSchema, quoteIdSchema, transactionIdSchema } from './ids';
import { amountSchema } from './money';
import { agentLevelSchema } from './registry';
import { taxFlagSchema, taxReasonSchema } from './x402-payment';
import { z } from 'zod';

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;
// "2026-27": the Indian financial year, April to March
export const financialYearSchema = z.string().regex(/^\d{4}-\d{2}$/);

// GET /v1/ledger query string
export const ledgerQuerySchema = z.object({
  receiverId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE)
});

export const ledgerRowSchema = z.object({
  paymentId: z.string().min(1),
  quoteId: quoteIdSchema,
  transactionId: transactionIdSchema,
  consensusAt: z.iso.datetime(),
  receiverId: z.string().min(1),
  agentId: z.string().min(1),
  agentLabel: z.string().min(1),
  // kosha_split settles atomically; compat is a standard exact payment that Core forwards
  mode: z.enum(['kosha_split', 'compat']),
  priceMicro: amountSchema,
  tdsMicro: amountSchema,
  inrValuePaise: amountSchema,
  rateBps: z.int().min(0).max(10_000),
  reason: taxReasonSchema,
  flags: z.array(taxFlagSchema),
  reserveAccountId: accountIdSchema.nullable(),
  hashscanUrl: z.url(),
  hcsSequence: z.int().positive().nullable(),
  // Seeded history is labelled in the Console
  sample: z.boolean()
});

export const ledgerPageSchema = z.object({
  rows: z.array(ledgerRowSchema),
  nextCursor: z.string().nullable()
});

// GET /v1/aggregates: one payer–receiver pair this financial year
export const aggregateRowSchema = z.object({
  receiverId: z.string().min(1),
  agentId: z.string().min(1),
  agentLevel: agentLevelSchema,
  payerResidency: payerResidencySchema,
  fy: financialYearSchema,
  valuePaise: amountSchema,
  outsideValuePaise: amountSchema,
  // The receiver's threshold: ₹50,000 for a specified person, ₹10,000 otherwise
  thresholdPaise: amountSchema,
  // Set for unverified payers under a threshold-tolerant receiver
  tolerancePaise: amountSchema.nullable(),
  // Display only: share of the nearer limit reached, 0–100 and beyond
  pct: z.number().nonnegative()
});

export const outsidePaymentRowSchema = z.object({
  id: z.string().min(1),
  receiverId: z.string().min(1),
  fromWallet: accountIdSchema,
  transactionId: transactionIdSchema,
  seenAt: z.iso.datetime(),
  valuePaise: amountSchema,
  shortfallPaise: amountSchema,
  classification: z.enum(['pending', 'consideration', 'not_consideration_gift']),
  note: z.string().nullable(),
  hcsSequence: z.int().positive().nullable()
});

// GET /v1/stream: server-sent events per receiver
export const streamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('payment.settled'), row: ledgerRowSchema }),
  z.object({
    type: z.literal('tds.withheld'),
    paymentId: z.string().min(1),
    tdsMicro: amountSchema,
    reserveAccountId: accountIdSchema.nullable()
  }),
  z.object({
    type: z.literal('threshold.near'),
    receiverId: z.string().min(1),
    agentId: z.string().min(1),
    pct: z.number().nonnegative(),
    // A Level 0 payer is asked to verify (Level 1) to drop from 20% to 1%
    promptLevel1: z.boolean()
  }),
  z.object({ type: z.literal('outside.payment'), row: outsidePaymentRowSchema })
]);

export type LedgerQuery = z.output<typeof ledgerQuerySchema>;
export type LedgerRow = z.output<typeof ledgerRowSchema>;
export type LedgerPage = z.output<typeof ledgerPageSchema>;
export type AggregateRow = z.output<typeof aggregateRowSchema>;
export type OutsidePaymentRow = z.output<typeof outsidePaymentRowSchema>;
export type StreamEvent = z.output<typeof streamEventSchema>;
