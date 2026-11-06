import type { HcsJson } from '@kosha/hedera/hcs';
import { createHmac } from 'node:crypto';

// The messages Core publishes on HCS_PAYMENTS_TOPIC (spec Component 1, "Settler"). HCS is public,
// so a payer–receiver pair appears only as an HMAC; never a PAN, a name or an internal ID pair.
// `agg` (the pair's total after the payment) and `rph` (the rule-pack hash prefix) let anyone
// recompute each decision.

export const HCS_MESSAGE_VERSION = 2;
const PAIR_ID_HEX_LENGTH = 32;
// "the first 8 bytes of the rule-pack hash"
const RULEPACK_HASH_PREFIX_HEX_LENGTH = 16;

export const pairId = (secret: string, agentId: string, receiverId: string): string =>
  createHmac('sha256', secret)
    .update(`${agentId}:${receiverId}`)
    .digest('hex')
    .slice(0, PAIR_ID_HEX_LENGTH);

export const rulepackHashPrefix = (hash: string): string =>
  hash.slice(0, RULEPACK_HASH_PREFIX_HEX_LENGTH);

export type PayMessageInput = {
  paymentId: string;
  transactionId: string;
  rulepack: string;
  rulepackHash: string;
  priceMicro: bigint;
  tdsMicro: bigint;
  rateBps: number;
  pair: string;
  fy: string;
  aggregatePaise: bigint;
  // Compatibility mode: paid to Kosha's settlement account and forwarded in a second transaction
  compat?: boolean;
};

export const payMessage = (input: PayMessageInput): HcsJson => ({
  v: HCS_MESSAGE_VERSION,
  t: 'pay',
  pid: input.paymentId,
  tx: input.transactionId,
  rp: input.rulepack,
  rph: rulepackHashPrefix(input.rulepackHash),
  price: input.priceMicro.toString(),
  tds: input.tdsMicro.toString(),
  bps: input.rateBps,
  pair: input.pair,
  fy: input.fy,
  agg: input.aggregatePaise.toString(),
  ...(input.compat ? { mode: 'compat' } : {})
});

// A decision for a payment on another rail (A24). `agg` includes this payment, as a pay message's
// does; it becomes final when the decision is confirmed.
export type DecisionMessageInput = {
  decisionId: string;
  chain: string;
  rulepack: string;
  rulepackHash: string;
  priceMicro: bigint;
  tdsMicro: bigint;
  rateBps: number;
  pair: string;
  fy: string;
  aggregatePaise: bigint;
};

export const decisionMessage = (input: DecisionMessageInput): HcsJson => ({
  v: HCS_MESSAGE_VERSION,
  t: 'decision',
  did: input.decisionId,
  chain: input.chain,
  rp: input.rulepack,
  rph: rulepackHashPrefix(input.rulepackHash),
  price: input.priceMicro.toString(),
  tds: input.tdsMicro.toString(),
  bps: input.rateBps,
  pair: input.pair,
  fy: input.fy,
  agg: input.aggregatePaise.toString()
});

// The decided payment settled on its rail: the reference ties the HCS log to that transaction
export const decisionConfirmedMessage = (input: {
  decisionId: string;
  chain: string;
  transactionRef: string;
}): HcsJson => ({
  v: HCS_MESSAGE_VERSION,
  t: 'decision_confirmed',
  did: input.decisionId,
  chain: input.chain,
  ref: input.transactionRef
});

// Published once per rule pack, so every pay message's `rph` points at a full hash on the topic
export const rulepackMessage = (rulepack: string, hash: string): HcsJson => ({
  v: HCS_MESSAGE_VERSION,
  t: 'rulepack',
  rp: rulepack,
  hash
});
