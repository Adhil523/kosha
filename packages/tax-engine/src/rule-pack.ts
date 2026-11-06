import { z } from 'zod';

const MAX_BPS = 10_000;

// Money in a rule pack is an integer count of paise. It is parsed into bigint, so it never meets a float.
const paiseSchema = z
  .int()
  .nonnegative()
  .transform((paise) => BigInt(paise));
const bpsSchema = z.int().min(0).max(MAX_BPS);
// e.g. "in-2026.2": country code, rule year, revision
const rulePackIdSchema = z.string().regex(/^[a-z]{2}-\d{4}\.\d+$/);

export const UNVERIFIED_POLICIES = ['strict', 'threshold_tolerant'] as const;
export const unverifiedPolicySchema = z.enum(UNVERIFIED_POLICIES);
export type UnverifiedPolicy = z.output<typeof unverifiedPolicySchema>;

export const rulePackSchema = z.strictObject({
  id: rulePackIdSchema,
  // The pack this one replaces, or null for the first pack of a law
  supersedes: rulePackIdSchema.nullable(),
  law: z.string().min(1),
  effectiveFrom: z.iso.date(),
  // "MM-01": financial years start on the 1st of a month, so quarters are whole months
  financialYearStart: z.string().regex(/^(0[1-9]|1[0-2])-01$/),
  // The tax base is the API's net price, never the all-in total the payer sends
  taxBase: z.literal('price'),
  rates: z.strictObject({
    standardBps: bpsSchema,
    noPanBps: bpsSchema
  }),
  // The yearly threshold belongs to the buyer (the API owner, who deducts): ₹50,000 when the
  // buyer is a specified person, ₹10,000 otherwise. The payer only sets the rate.
  thresholds: z.strictObject({
    keyedTo: z.literal('buyer'),
    specifiedBuyerPaise: paiseSchema,
    otherBuyerPaise: paiseSchema
  }),
  // "full": withhold on the whole payment that crosses the threshold; "excess": only on the part above it
  crossing: z.enum(['full', 'excess']),
  // A payer with no verified profile pays the no-PAN rate. "strict" receivers withhold from the
  // first rupee; "threshold_tolerant" ones (the default) allow up to the tolerance first.
  unverifiedPayer: z.strictObject({
    defaultPolicy: unverifiedPolicySchema,
    toleranceLimitPaise: paiseSchema
  }),
  // Mode C: the payer funds its own TDS into its own reserve; the API gets exactly its price
  funding: z.literal('payer_reserve'),
  // A non-resident on either side withholds nothing and flags the payment for FEMA review
  nonResidentPayer: z.literal('no_tds_flag_fema'),
  nonResidentReceiver: z.literal('no_tds_flag_fema'),
  fxSource: z.string().min(1),
  // Stays null until a CA signs off; the Console shows "unreviewed" until then
  reviewedBy: z.string().min(1).nullable()
});

export type RulePack = z.output<typeof rulePackSchema>;
export type RulePackInput = z.input<typeof rulePackSchema>;
export type Crossing = RulePack['crossing'];
