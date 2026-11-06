import { accountIdSchema, agentIdentitySchema } from './ids';
import { amountSchema } from './money';
import { z } from 'zod';

// Admin-only endpoints `pnpm seed --history` and `--reset-demo` call (A14). Parties are named the
// way the seed knows them: the agent's identity and the receiver's wallet, never Core's IDs.

const MAX_SAMPLES_PER_CALL = 500;

// POST /v1/admin/sample-payments: settled history, labelled sample, that never touched the chain
export const samplePaymentSchema = z.object({
  // Stable per sample, so a second seed run inserts nothing new
  key: z.string().min(1).max(100),
  agent: agentIdentitySchema,
  receiverAccountId: accountIdSchema,
  at: z.iso.datetime(),
  priceMicroUsdc: amountSchema,
  resource: z.url()
});
export const samplePaymentsRequestSchema = z.object({
  payments: z.array(samplePaymentSchema).min(1).max(MAX_SAMPLES_PER_CALL)
});
export const samplePaymentsResponseSchema = z.object({
  inserted: z.int().nonnegative(),
  existing: z.int().nonnegative()
});

// POST /v1/admin/demo-reset: puts the threshold demo back where `pnpm demo` starts
export const demoResetRequestSchema = z.object({
  // Each pair's year total becomes exactly this, as one sample opening balance
  balances: z.array(
    z.object({
      agent: agentIdentitySchema,
      receiverAccountId: accountIdSchema,
      valuePaise: amountSchema
    })
  ),
  // These agents' own (non-sample) payments and open quotes are cleared
  clearAgents: z.array(agentIdentitySchema),
  // These agents go back to Level 0, unverified
  level0: z.array(agentIdentitySchema)
});
export const demoResetResponseSchema = z.object({
  clearedPayments: z.int().nonnegative(),
  balancedPairs: z.int().nonnegative(),
  level0Agents: z.int().nonnegative()
});

export type SamplePayment = z.output<typeof samplePaymentSchema>;
export type SamplePaymentsRequest = z.output<typeof samplePaymentsRequestSchema>;
export type SamplePaymentsResponse = z.output<typeof samplePaymentsResponseSchema>;
export type DemoResetRequest = z.output<typeof demoResetRequestSchema>;
export type DemoResetResponse = z.output<typeof demoResetResponseSchema>;
