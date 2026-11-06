import type { HcsJson } from '@kosha/hedera/hcs';
import { RECEIVER_MODES, THRESHOLD_ACTIONS, UNVERIFIED_POLICIES } from '@kosha/shared/registry';
import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp
} from 'drizzle-orm/pg-core';

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
    verifiedAt: utc('verifiedAt'),
    // HCS-11 profile topic behind a UAID, checked at registration (A18) and never per request.
    // Both stay null for a CAIP-10 agent, or when Core runs without the profile check.
    profileTopicID: text('profileTopicID'),
    profileCheckedAt: utc('profileCheckedAt')
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

export const QUOTE_SCHEMES = ['kosha_split', 'exact_compat'] as const;
export const PAYMENT_STATUSES = ['pending', 'settled', 'failed'] as const;

// One priced request. Its id is the x402 quote id (q_…), bound into the transaction memo.
export const quote = pgTable(
  'Quote',
  {
    ...base,
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `q_${createId()}`),
    scheme: text('scheme', { enum: QUOTE_SCHEMES }).notNull(),
    receiverID: text('receiverID')
      .notNull()
      .references(() => receiver.id),
    // Null for an unidentified caller of the compatibility entry
    agentID: text('agentID').references(() => agent.id),
    resource: text('resource').notNull(),
    payToAccountID: text('payToAccountID').notNull(),
    reserveAccountID: text('reserveAccountID'),
    priceMicro: money('priceMicro').notNull(),
    tdsMicro: money('tdsMicro').notNull(),
    totalMicro: money('totalMicro').notNull(),
    inrValuePaise: money('inrValuePaise').notNull(),
    rateBps: integer('rateBps').notNull(),
    reason: text('reason').notNull(),
    rulepack: text('rulepack').notNull(),
    // Micro-rupees per USD at quote time
    inrPerUsdMicro: money('inrPerUsdMicro').notNull(),
    nodeAccountIDs: text('nodeAccountIDs').array().notNull(),
    fy: text('fy').notNull(),
    expiresAt: utc('expiresAt').notNull(),
    // Set before execution, so a retried settle can't spend the quote twice
    usedTransactionID: text('usedTransactionID').unique()
  },
  (table) => [
    check('quoteTotal', sql`${table.totalMicro} = ${table.priceMicro} + ${table.tdsMicro}`)
  ]
);

export const payment = pgTable('Payment', {
  ...base,
  quoteID: text('quoteID')
    .notNull()
    .unique()
    .references(() => quote.id),
  transactionID: text('transactionID').notNull().unique(),
  // Compatibility mode only: Core's second transaction to the API and the pooled reserve
  forwardTransactionID: text('forwardTransactionID').unique(),
  // Set once the forward is confirmed; until then a set forwardTransactionID is an attempt in flight
  forwardedAt: utc('forwardedAt'),
  consensusAt: utc('consensusAt'),
  receiverID: text('receiverID')
    .notNull()
    .references(() => receiver.id),
  agentID: text('agentID').references(() => agent.id),
  priceMicro: money('priceMicro').notNull(),
  tdsMicro: money('tdsMicro').notNull(),
  reserveAccountID: text('reserveAccountID'),
  inrValuePaise: money('inrValuePaise').notNull(),
  fy: text('fy').notNull(),
  hcsSequence: integer('hcsSequence'),
  status: text('status', { enum: PAYMENT_STATUSES }).notNull().default('pending'),
  // Seeded demo history (A14): never on chain, labelled as sample in the Console
  sample: boolean('sample').notNull().default(false)
});

// One payer–receiver pair's running total for a financial year. The quote service adds open
// quotes on top, so concurrent quotes can't both slip under the threshold.
export const aggregate = pgTable(
  'Aggregate',
  {
    agentID: text('agentID')
      .notNull()
      .references(() => agent.id),
    receiverID: text('receiverID')
      .notNull()
      .references(() => receiver.id),
    fy: text('fy').notNull(),
    valuePaise: money('valuePaise')
      .notNull()
      .default(sql`0`),
    outsideValuePaise: money('outsideValuePaise')
      .notNull()
      .default(sql`0`),
    paymentsCount: integer('paymentsCount').notNull().default(0),
    createdAt: base.createdAt,
    updatedAt: base.updatedAt
  },
  (table) => [primaryKey({ columns: [table.agentID, table.receiverID, table.fy] })]
);

// A tax decision for a payment settled on another rail (POST /v1/decide, A24). Like a quote, an
// unconfirmed decision is held against its pair's total until it expires, so two decisions near the
// threshold can't both skip TDS. The payer is a Kosha agent, or a facilitator's own reference.
export const decision = pgTable(
  'Decision',
  {
    ...base,
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `dec_${createId()}`),
    receiverID: text('receiverID')
      .notNull()
      .references(() => receiver.id),
    agentID: text('agentID').references(() => agent.id),
    // The calling facilitator's own payer reference, when it sends claims instead of an identity
    payerReference: text('payerReference'),
    chain: text('chain').notNull(),
    resource: text('resource'),
    priceMicro: money('priceMicro').notNull(),
    inrPerUsdMicro: money('inrPerUsdMicro').notNull(),
    valuePaise: money('valuePaise').notNull(),
    tdsPaise: money('tdsPaise').notNull(),
    tdsMicro: money('tdsMicro').notNull(),
    rateBps: integer('rateBps').notNull(),
    reason: text('reason').notNull(),
    flags: text('flags').array().notNull(),
    rulepack: text('rulepack').notNull(),
    fy: text('fy').notNull(),
    expiresAt: utc('expiresAt').notNull(),
    // Set by POST /v1/decisions/:id/confirm once the payment settled on its rail
    confirmedAt: utc('confirmedAt'),
    transactionRef: text('transactionRef')
  },
  (table) => [
    check('decisionPayer', sql`(${table.agentID} is null) <> (${table.payerReference} is null)`)
  ]
);

export const HCS_MESSAGE_KINDS = [
  'pay',
  'rulepack',
  'decision',
  'decision_confirmed',
  'outside',
  'outside_resolved',
  'challan'
] as const;

// Written in the same transaction as the payment; a loop publishes it to HCS and records the
// sequence number (PROTOCOL design fix 6)
export const hcsOutbox = pgTable('HcsOutbox', {
  ...base,
  kind: text('kind', { enum: HCS_MESSAGE_KINDS }).notNull(),
  topicID: text('topicID').notNull(),
  payload: jsonb('payload').$type<HcsJson>().notNull(),
  paymentID: text('paymentID').references(() => payment.id),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('lastError'),
  hcsSequence: integer('hcsSequence'),
  publishedAt: utc('publishedAt')
});
