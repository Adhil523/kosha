import { RECEIVER_MODES, THRESHOLD_ACTIONS, UNVERIFIED_POLICIES } from '@kosha/shared/registry';
import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { bigint, boolean, check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// The source of truth for Core's database; migrations are generated from it (`pnpm db:generate`).
// Money is an integer count of minor units (micro-USDC or paise) in a bigint column: exact, like
// numeric, and the same unit the wire and the tax engine use. Enum-like columns hold the wire
// values, which are the contract. Timestamps are timestamptz, written in UTC.

const money = (name: string) => bigint(name, { mode: 'bigint' });
const utc = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

// Every table that has its own identity gets these
const base = {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  createdAt: utc('createdAt').notNull().defaultNow(),
  updatedAt: utc('updatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
};

export const RESIDENCIES = ['resident', 'non_resident'] as const;
export const PAYER_RESIDENCIES = ['resident', 'non_resident', 'unknown'] as const;

// An API owner: the buyer of the USDC and the deductor
export const receiver = pgTable('Receiver', {
  ...base,
  legalName: text('legalName').notNull(),
  // Salted HMAC of the PAN (never the PAN); a foreign API has none
  panCommitment: text('panCommitment'),
  tan: text('tan'),
  gstin: text('gstin'),
  residency: text('residency', { enum: RESIDENCIES }).notNull(),
  // Sets the yearly threshold: ₹50,000 for a specified person, ₹10,000 otherwise
  specifiedPerson: boolean('specifiedPerson').notNull(),
  mode: text('mode', { enum: RECEIVER_MODES }).notNull(),
  unverifiedPolicy: text('unverifiedPolicy', { enum: UNVERIFIED_POLICIES }).notNull(),
  apiKeyHash: text('apiKeyHash').notNull().unique()
});

// Each wallet proved its ownership by signing a Core challenge
export const receiverWallet = pgTable('ReceiverWallet', {
  ...base,
  receiverID: text('receiverID')
    .notNull()
    .references(() => receiver.id),
  accountID: text('accountID').notNull().unique(),
  proofSignature: text('proofSignature').notNull(),
  verifiedAt: utc('verifiedAt').notNull()
});

// A payer agent (the deductee). Level 0 agents are registered on their first quote.
export const agent = pgTable(
  'Agent',
  {
    ...base,
    // HCS-14 UAID, or the CAIP-10 account of a Level 0 agent
    identity: text('identity').notNull().unique(),
    ownerRef: text('ownerRef'),
    level: integer('level').notNull().default(0),
    residency: text('residency', { enum: PAYER_RESIDENCIES }).notNull().default('unknown'),
    panOnFile: boolean('panOnFile').notNull().default(false),
    credentialIssuer: text('credentialIssuer'),
    credentialHash: text('credentialHash'),
    // The agent's own 2-of-2 TDS reserve; null until Core creates it
    reserveAccountID: text('reserveAccountID').unique(),
    verifiedAt: utc('verifiedAt')
  },
  (table) => [check('agentLevelRange', sql`${table.level} between 0 and 2`)]
);

export const agentWallet = pgTable('AgentWallet', {
  ...base,
  agentID: text('agentID')
    .notNull()
    .references(() => agent.id),
  accountID: text('accountID').notNull().unique()
});

// Spending rules Core enforces at quote and verify; caps count the all-in total
export const policy = pgTable('Policy', {
  ...base,
  agentID: text('agentID')
    .notNull()
    .unique()
    .references(() => agent.id),
  perPaymentMicro: money('perPaymentMicro').notNull(),
  dailyMicro: money('dailyMicro').notNull(),
  fyBudgetMicro: money('fyBudgetMicro').notNull(),
  allowlist: text('allowlist').array().notNull(),
  thresholdAction: text('thresholdAction', { enum: THRESHOLD_ACTIONS }).notNull(),
  acceptRulepacks: text('acceptRulepacks').array().notNull()
});
