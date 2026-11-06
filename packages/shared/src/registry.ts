import { payerResidencySchema, residencySchema } from './facilitator-api';
import { accountIdSchema, agentIdentitySchema } from './ids';
import { amountSchema } from './money';
import { z } from 'zod';

// Indian tax identifiers. The PAN is checked here and then committed (salted HMAC) by Core; it is
// never stored raw.
const PAN_PATTERN = /^[A-Z]{5}\d{4}[A-Z]$/;
const TAN_PATTERN = /^[A-Z]{4}\d{5}[A-Z]$/;
const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const HEX_PATTERN = /^[0-9a-f]+$/;

export const RECEIVER_MODES = ['threshold', 'first_rupee'] as const;
export const UNVERIFIED_POLICIES = ['strict', 'threshold_tolerant'] as const;
export const THRESHOLD_ACTIONS = ['warn', 'block', 'allow'] as const;

export const receiverModeSchema = z.enum(RECEIVER_MODES);
export const unverifiedPolicySchema = z.enum(UNVERIFIED_POLICIES);
export const agentLevelSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);

// GET /v1/receivers/challenge: each wallet signs the nonce to prove ownership
export const receiverChallengeSchema = z.object({
  nonce: z.string().regex(HEX_PATTERN).min(32),
  expiresAt: z.iso.datetime()
});

export const walletProofSchema = z.object({
  accountId: accountIdSchema,
  // Hex signature over the challenge nonce by the account's key (checked against the Mirror Node)
  signature: z.string().regex(HEX_PATTERN)
});

// POST /v1/receivers (admin). Specified persons need PAN only; other resident deductors need a TAN.
export const receiverCreateSchema = z
  .object({
    legalName: z.string().min(1),
    residency: residencySchema,
    specifiedPerson: z.boolean(),
    pan: z.string().regex(PAN_PATTERN).optional(),
    tan: z.string().regex(TAN_PATTERN).optional(),
    gstin: z.string().regex(GSTIN_PATTERN).optional(),
    mode: receiverModeSchema,
    // Defaults to the rule pack's unverifiedPayer.defaultPolicy
    unverifiedPolicy: unverifiedPolicySchema.optional(),
    challengeNonce: z.string().regex(HEX_PATTERN),
    wallets: z.array(walletProofSchema).min(1),
    // The seed supplies its own key; otherwise Core generates one and returns it once
    apiKey: z.string().min(32).optional()
  })
  .superRefine((receiver, ctx) => {
    if (receiver.residency !== 'resident') return;
    if (!receiver.pan) {
      ctx.addIssue({ code: 'custom', path: ['pan'], message: 'a resident receiver needs a PAN' });
    }
    if (!receiver.specifiedPerson && !receiver.tan) {
      ctx.addIssue({
        code: 'custom',
        path: ['tan'],
        message: 'a resident receiver that is not a specified person needs a TAN'
      });
    }
  });

export const receiverCreatedSchema = z.object({
  receiverId: z.string().min(1),
  apiKey: z.string().min(32).optional()
});

// Signed by an issuer (the test issuer in the MVP, a KYC provider later). Level 1 is PAN or a
// non-resident declaration; Level 2 is full KYC. Specified-person status is a receiver property.
export const credentialSchema = z.object({
  issuer: z.string().min(1),
  subject: agentIdentitySchema,
  claims: z.object({
    residency: residencySchema,
    panOnFile: z.boolean(),
    level: z.union([z.literal(1), z.literal(2)])
  }),
  issuedAt: z.iso.datetime(),
  // Ed25519 over the canonical JSON of everything above
  signature: z.string().regex(HEX_PATTERN)
});

// POST /v1/agents. Level 0 agents are registered by Core on their first quote instead.
export const agentRegisterSchema = z.object({
  identity: agentIdentitySchema,
  credential: credentialSchema.optional(),
  wallets: z.array(accountIdSchema).min(1),
  // Bootstrap's reserve for a demo agent; otherwise Core creates one
  reserveAccountId: accountIdSchema.optional()
});

export const agentRowSchema = z.object({
  agentId: z.string().min(1),
  identity: agentIdentitySchema,
  level: agentLevelSchema,
  residency: payerResidencySchema,
  panOnFile: z.boolean(),
  wallets: z.array(accountIdSchema),
  reserveAccountId: accountIdSchema.nullable(),
  credentialIssuer: z.string().nullable(),
  verifiedAt: z.iso.datetime().nullable()
});

// GET/PUT /v1/agents/:id/policy. Caps count the all-in total, tax included.
export const policySchema = z.object({
  perPaymentMicro: amountSchema,
  dailyMicro: amountSchema,
  fyBudgetMicro: amountSchema,
  allowlist: z.array(z.string().min(1)),
  thresholdAction: z.enum(THRESHOLD_ACTIONS),
  acceptRulepacks: z.array(z.string().min(1)).min(1)
});

// Verification terms agreed before the first paid call (B26 and A21)
export const termsProposalSchema = z.object({
  level: agentLevelSchema,
  credentialRef: z.string().optional(),
  acceptRulepacks: z.array(z.string().min(1)).min(1)
});
export const termsAnswerSchema = z.object({
  answer: z.enum(['accept', 'counter']),
  rateBps: z.int().min(0).max(10_000),
  message: z.string().optional()
});

export type ReceiverCreate = z.output<typeof receiverCreateSchema>;
export type Credential = z.output<typeof credentialSchema>;
export type AgentRegister = z.output<typeof agentRegisterSchema>;
export type AgentRow = z.output<typeof agentRowSchema>;
export type AgentLevel = z.output<typeof agentLevelSchema>;
export type Policy = z.output<typeof policySchema>;
export type TermsProposal = z.output<typeof termsProposalSchema>;
export type TermsAnswer = z.output<typeof termsAnswerSchema>;
