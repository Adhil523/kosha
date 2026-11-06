import { findAgentByIdentity } from './agent-identity';
import { SETTLEMENT_NODE_ACCOUNT_IDS } from './config';
import type { KoshaDb } from './db/client';
import {
  type agent,
  agentWallet,
  aggregate,
  payment,
  quote,
  receiver,
  receiverWallet
} from './db/schema';
import type { FxSource } from './fx';
import { addToAggregate } from './ledger';
import { withPairLock } from './pair-total';
import type { SamplePayment } from '@kosha/shared/demo-admin';
import { applyFunding } from '@kosha/tax-engine/apply-funding';
import { decide } from '@kosha/tax-engine/decide';
import { financialYear } from '@kosha/tax-engine/ist-calendar';
import type { RulePack } from '@kosha/tax-engine/rule-pack';
import { and, asc, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';

export type SampleDeps = { db: KoshaDb; pack: RulePack; fx: FxSource };

export type Parties = {
  agent: typeof agent.$inferSelect;
  payerAccountId: string;
  receiver: typeof receiver.$inferSelect;
  receiverAccountId: string;
};

export type SampleResult =
  | { ok: true; data: { inserted: number; existing: number } }
  | { ok: false; data: { message: string } };

const QUOTE_TTL_MS = 120_000;
const NANOS_DIGITS = 9;

const digest = (key: string) => createHash('sha256').update(key).digest('hex');

// Deterministic from the sample's key, so a second seed run finds the row and skips it
export const sampleQuoteId = (key: string): string => `q_sample${digest(key).slice(0, 24)}`;

// Shaped like a Hedera transaction ID so the ledger row parses; it was never on chain
const sampleTransactionId = (payer: string, at: Date, key: string): string => {
  const nanos = (BigInt(`0x${digest(key).slice(0, 12)}`) % 10n ** 9n).toString();
  return `${payer}@${Math.floor(at.getTime() / 1000)}.${nanos.padStart(NANOS_DIGITS, '0')}`;
};

// The agent by identity (or its account, after a UAID upgrade) and the receiver by its wallet:
// the names the seed knows
export const findParties = async (
  db: KoshaDb,
  identity: string,
  receiverAccountId: string
): Promise<Parties | null> => {
  const found = await findAgentByIdentity(db, identity);
  const [payer] = found
    ? await db
        .select({ payerAccountId: agentWallet.accountID })
        .from(agentWallet)
        .where(eq(agentWallet.agentID, found.id))
        .orderBy(asc(agentWallet.createdAt))
    : [];
  const [payee] = await db
    .select({ receiver })
    .from(receiverWallet)
    .innerJoin(receiver, eq(receiver.id, receiverWallet.receiverID))
    .where(eq(receiverWallet.accountID, receiverAccountId));
  if (!found || !payer || !payee) return null;
  return {
    agent: found,
    payerAccountId: payer.payerAccountId,
    receiver: payee.receiver,
    receiverAccountId
  };
};

const pairValuePaise = async (tx: KoshaDb, agentId: string, receiverId: string, fy: string) => {
  const [row] = await tx
    .select({ value: aggregate.valuePaise, outside: aggregate.outsideValuePaise })
    .from(aggregate)
    .where(
      and(
        eq(aggregate.agentID, agentId),
        eq(aggregate.receiverID, receiverId),
        eq(aggregate.fy, fy)
      )
    );
  return (row?.value ?? 0n) + (row?.outside ?? 0n);
};

// Writes one sample as a settled payment, taxed by decide() against the pair's total so far,
// exactly as a live payment would be, but with no transaction and no HCS record
const recordOne = async (
  deps: SampleDeps,
  parties: Parties,
  sample: SamplePayment,
  rate: bigint
) => {
  const at = new Date(sample.at);
  const pair = {
    agentId: parties.agent.id,
    receiverId: parties.receiver.id,
    fy: financialYear(at, deps.pack.financialYearStart)
  };
  const price = BigInt(sample.priceMicroUsdc);
  const transactionId = sampleTransactionId(parties.payerAccountId, at, sample.key);

  await withPairLock(deps.db, pair, async (tx) => {
    const decision = decide({
      payer: { residency: parties.agent.residency, panOnFile: parties.agent.panOnFile },
      receiver: parties.receiver,
      priceMicroUsdc: price,
      inrPerUsdMicro: rate,
      aggregatePaise: await pairValuePaise(tx, pair.agentId, pair.receiverId, pair.fy),
      pack: deps.pack
    });
    const split = applyFunding({ priceMicroUsdc: price, tdsMicroUsdc: decision.tdsMicroUsdc });
    const reserve = split.reserveMicro > 0n ? parties.agent.reserveAccountID : null;
    const [quoted] = await tx
      .insert(quote)
      .values({
        id: sampleQuoteId(sample.key),
        createdAt: at,
        scheme: 'kosha_split',
        receiverID: pair.receiverId,
        agentID: pair.agentId,
        resource: sample.resource,
        payToAccountID: parties.receiverAccountId,
        reserveAccountID: parties.agent.reserveAccountID,
        priceMicro: split.receiverMicro,
        tdsMicro: split.reserveMicro,
        totalMicro: split.payerTotalMicro,
        inrValuePaise: decision.valuePaise,
        rateBps: decision.rateBps,
        reason: decision.reason,
        rulepack: decision.rulepack,
        inrPerUsdMicro: rate,
        nodeAccountIDs: [...SETTLEMENT_NODE_ACCOUNT_IDS],
        fy: pair.fy,
        expiresAt: new Date(at.getTime() + QUOTE_TTL_MS),
        usedTransactionID: transactionId
      })
      .returning({ id: quote.id });
    await tx.insert(payment).values({
      quoteID: quoted?.id ?? '',
      transactionID: transactionId,
      createdAt: at,
      consensusAt: at,
      receiverID: pair.receiverId,
      agentID: pair.agentId,
      priceMicro: split.receiverMicro,
      tdsMicro: split.reserveMicro,
      reserveAccountID: reserve,
      inrValuePaise: decision.valuePaise,
      fy: pair.fy,
      status: 'settled',
      sample: true
    });
    await addToAggregate(tx, pair, decision.valuePaise);
  });
};

// Records sample history oldest first, skipping samples already recorded. Every party must be
// registered first (`pnpm seed --profiles`); otherwise nothing is written.
export const recordSamplePayments = async (
  deps: SampleDeps,
  samples: SamplePayment[]
): Promise<SampleResult> => {
  const parties = new Map<string, Parties>();
  for (const { agent: identity, receiverAccountId } of samples) {
    const pairKey = `${identity}|${receiverAccountId}`;
    if (parties.has(pairKey)) continue;
    const found = await findParties(deps.db, identity, receiverAccountId);
    if (!found) {
      return {
        ok: false,
        data: { message: `${identity} or ${receiverAccountId} is not registered` }
      };
    }
    parties.set(pairKey, found);
  }

  const rate = (await deps.fx.current()).inrPerUsdMicro;
  const ordered = [...samples].sort((a, b) => a.at.localeCompare(b.at));
  let inserted = 0;
  for (const sample of ordered) {
    const [seen] = await deps.db
      .select({ id: quote.id })
      .from(quote)
      .where(eq(quote.id, sampleQuoteId(sample.key)));
    const pairParties = parties.get(`${sample.agent}|${sample.receiverAccountId}`);
    if (seen || !pairParties) continue;
    await recordOne(deps, pairParties, sample, rate);
    inserted += 1;
  }
  return { ok: true, data: { inserted, existing: samples.length - inserted } };
};
