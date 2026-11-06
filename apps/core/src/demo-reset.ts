import { SETTLEMENT_NODE_ACCOUNT_IDS } from './config';
import type { KoshaDb } from './db/client';
import { agent, aggregate, hcsOutbox, payment, quote } from './db/schema';
import { findParties, type Parties, type SampleDeps } from './sample-payments';
import type { DemoResetRequest, DemoResetResponse } from '@kosha/shared/demo-admin';
import { financialYear } from '@kosha/tax-engine/ist-calendar';
import { paiseToMicroUsdc } from '@kosha/tax-engine/minor-units';
import { and, eq, inArray, notExists, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';

export type ResetResult =
  { ok: true; data: DemoResetResponse } | { ok: false; data: { message: string } };

const DAY_MS = 86_400_000;
const OPENING_RESOURCE = 'https://kosha.demo/sample/opening-balance';

// Removes payments and everything that points at them: their unpublished HCS rows, then the
// payments, then their quotes. Already-published HCS messages stay on chain.
const deletePayments = async (tx: KoshaDb, paymentIds: string[], quoteIds: string[]) => {
  if (paymentIds.length > 0) {
    await tx.delete(hcsOutbox).where(inArray(hcsOutbox.paymentID, paymentIds));
    await tx.delete(payment).where(inArray(payment.id, paymentIds));
  }
  if (quoteIds.length > 0) await tx.delete(quote).where(inArray(quote.id, quoteIds));
};

// One sample payment carrying the pair's whole year so far, dated a day back
const insertOpening = async (
  tx: KoshaDb,
  parties: Parties,
  valuePaise: bigint,
  rate: bigint,
  at: Date,
  fy: string
) => {
  const price = paiseToMicroUsdc(valuePaise, rate);
  const seconds = Math.floor(at.getTime() / 1000);
  const tag = createHash('sha256')
    .update(`${parties.agent.id}:${parties.receiver.id}`)
    .digest('hex');
  const transactionId = `${parties.payerAccountId}@${seconds}.${BigInt(`0x${tag.slice(0, 7)}`)}`;
  const [opening] = await tx
    .insert(quote)
    .values({
      id: `q_sampleopen${tag.slice(0, 20)}`,
      createdAt: at,
      scheme: 'kosha_split',
      receiverID: parties.receiver.id,
      agentID: parties.agent.id,
      resource: OPENING_RESOURCE,
      payToAccountID: parties.receiverAccountId,
      reserveAccountID: parties.agent.reserveAccountID,
      priceMicro: price,
      tdsMicro: 0n,
      totalMicro: price,
      inrValuePaise: valuePaise,
      rateBps: 0,
      reason: 'under_threshold',
      rulepack: 'sample',
      inrPerUsdMicro: rate,
      nodeAccountIDs: [...SETTLEMENT_NODE_ACCOUNT_IDS],
      fy,
      expiresAt: at,
      usedTransactionID: transactionId
    })
    .returning({ id: quote.id });
  await tx.insert(payment).values({
    quoteID: opening?.id ?? '',
    transactionID: transactionId,
    createdAt: at,
    consensusAt: at,
    receiverID: parties.receiver.id,
    agentID: parties.agent.id,
    priceMicro: price,
    tdsMicro: 0n,
    inrValuePaise: valuePaise,
    fy,
    status: 'settled',
    sample: true
  });
};

// Puts the threshold demo back to its starting point (A14 `seed --reset-demo`); see the request
// schema for what each list means. Every pair the reset touches has its year total recomputed
// from the payments that remain, so the aggregate and the ledger agree.
export const resetDemo = async (
  deps: SampleDeps,
  request: DemoResetRequest,
  now: Date
): Promise<ResetResult> => {
  const identities = [...new Set([...request.clearAgents, ...request.level0])];
  const agents = await deps.db
    .select({ id: agent.id, identity: agent.identity })
    .from(agent)
    .where(inArray(agent.identity, identities.length > 0 ? identities : ['']));
  const idOf = new Map(agents.map((row) => [row.identity, row.id]));
  const balances: { parties: Parties; valuePaise: bigint }[] = [];
  for (const balance of request.balances) {
    const parties = await findParties(deps.db, balance.agent, balance.receiverAccountId);
    if (!parties) {
      return { ok: false, data: { message: `${balance.agent} or its receiver is not registered` } };
    }
    balances.push({ parties, valuePaise: BigInt(balance.valuePaise) });
  }
  const missing = identities.find((identity) => !idOf.has(identity));
  if (missing) return { ok: false, data: { message: `${missing} is not registered` } };

  const fy = financialYear(now, deps.pack.financialYearStart);
  const dayBack = new Date(now.getTime() - DAY_MS);
  const openingAt = financialYear(dayBack, deps.pack.financialYearStart) === fy ? dayBack : now;
  const rate = (await deps.fx.current()).inrPerUsdMicro;
  const clearIds = request.clearAgents.map((identity) => idOf.get(identity) ?? '');
  const level0Ids = request.level0.map((identity) => idOf.get(identity) ?? '');

  const data = await deps.db.transaction(async (tx) => {
    // The demo's own payments, and quotes it opened but never paid
    const live =
      clearIds.length > 0
        ? await tx
            .select({ id: payment.id, quoteID: payment.quoteID })
            .from(payment)
            .where(and(inArray(payment.agentID, clearIds), eq(payment.sample, false)))
        : [];
    await deletePayments(
      tx,
      live.map((row) => row.id),
      live.map((row) => row.quoteID)
    );
    if (clearIds.length > 0) {
      await tx
        .delete(quote)
        .where(
          and(
            inArray(quote.agentID, clearIds),
            notExists(tx.select().from(payment).where(eq(payment.quoteID, quote.id)))
          )
        );
    }

    for (const { parties, valuePaise } of balances) {
      const pairRows = await tx
        .select({ id: payment.id, quoteID: payment.quoteID })
        .from(payment)
        .where(
          and(
            eq(payment.agentID, parties.agent.id),
            eq(payment.receiverID, parties.receiver.id),
            eq(payment.fy, fy)
          )
        );
      await deletePayments(
        tx,
        pairRows.map((row) => row.id),
        pairRows.map((row) => row.quoteID)
      );
      await insertOpening(tx, parties, valuePaise, rate, openingAt, fy);
      await tx
        .insert(aggregate)
        .values({ agentID: parties.agent.id, receiverID: parties.receiver.id, fy })
        .onConflictDoNothing();
    }

    // Recount every touched pair from what remains
    const touched = [...new Set([...clearIds, ...balances.map((row) => row.parties.agent.id)])];
    if (touched.length > 0) {
      const sameFyPair = and(
        eq(payment.agentID, aggregate.agentID),
        eq(payment.receiverID, aggregate.receiverID),
        eq(payment.fy, aggregate.fy),
        inArray(payment.status, ['settled', 'pending'])
      );
      await tx
        .update(aggregate)
        .set({
          valuePaise: sql`coalesce((select sum(${payment.inrValuePaise}) from ${payment} where ${sameFyPair}), 0)`,
          paymentsCount: sql`(select count(*) from ${payment} where ${sameFyPair})::int`
        })
        .where(and(inArray(aggregate.agentID, touched), eq(aggregate.fy, fy)));
    }

    if (level0Ids.length > 0) {
      await tx
        .update(agent)
        .set({
          level: 0,
          residency: 'unknown',
          panOnFile: false,
          credentialIssuer: null,
          credentialHash: null,
          verifiedAt: null,
          profileTopicID: null,
          profileCheckedAt: null
        })
        .where(inArray(agent.id, level0Ids));
    }
    return {
      clearedPayments: live.length,
      balancedPairs: balances.length,
      level0Agents: level0Ids.length
    };
  });
  return { ok: true, data };
};
