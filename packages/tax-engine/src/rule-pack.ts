import { z } from 'zod';

const MAX_BPS = 10_000;

// Money in a rule pack is an integer count of paise. It is parsed into bigint, so it never meets a float.
const paiseSchema = z
  .int()
  .nonnegative()
  .transform((paise) => BigInt(paise));
const bpsSchema = z.int().min(0).max(MAX_BPS);

export const rulePackSchema = z.strictObject({
  // e.g. "in-2026.1": country code, rule year, revision
  id: z.string().regex(/^[a-z]{2}-\d{4}\.\d+$/),
  law: z.string().min(1),
  effectiveFrom: z.iso.date(),
  // "MM-01": financial years start on the 1st of a month, so quarters are whole months
  financialYearStart: z.string().regex(/^(0[1-9]|1[0-2])-01$/),
  rates: z.strictObject({
    standardBps: bpsSchema,
    noPanBps: bpsSchema
  }),
  thresholds: z.strictObject({
    specifiedPersonPaise: paiseSchema,
    otherPaise: paiseSchema
  }),
  // "full": withhold on the whole payment that crosses the threshold; "excess": only on the part above it
  crossing: z.enum(['full', 'excess']),
  // A payer with no verified profile is treated as a resident with no PAN, from the first rupee
  unknownPayer: z.literal('first_rupee_no_pan'),
  funding: z.enum(['payer', 'price_inclusive']),
  nonResident: z.literal('no_tds_flag_fema'),
  // A non-resident receiver (a foreign API) withholds nothing and flags the payment for FEMA review
  receiverNonResident: z.literal('no_tds_flag_fema'),
  fxSource: z.string().min(1),
  // Stays null until a CA signs off; the Console shows "unreviewed" until then
  reviewedBy: z.string().min(1).nullable()
});

export type RulePack = z.output<typeof rulePackSchema>;
export type RulePackInput = z.input<typeof rulePackSchema>;
export type Crossing = RulePack['crossing'];
export type Funding = RulePack['funding'];
