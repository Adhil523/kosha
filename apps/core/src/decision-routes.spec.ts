import { buildApp } from './app';
import type { DbHandle } from './db/client';
import { agent, aggregate, decision, hcsOutbox } from './db/schema';
import { testDb } from './db/test-db';
import { decisionRoutes } from './decision-routes';
import { demoFixedFx } from './fx';
import {
  FY,
  type LedgerSeed,
  loadTestPack,
  NOW,
  receiverAuth,
  seedParties
} from './ledger.fixture';
import type { DecideResponse } from '@kosha/shared/facilitator-api';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const RESIDENT = 'hedera:testnet:0.0.6001';
// 0.10 USDC at ₹88.40 is ₹8.84
const PRICE = { priceMicroUsdc: '100000', chain: 'eip155:8453' };

describe('POST /v1/decide and /v1/decisions/:id/confirm', () => {
  let handle: DbHandle;
  let app: ReturnType<typeof buildApp>;
  let seed: LedgerSeed;

  const decideFor = async (payer: object, extra: object = {}, as: 'in' | 'solo' = 'in') => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/decide',
      headers: receiverAuth(as),
      payload: { ...PRICE, payer, ...extra }
    });
    return { status: response.statusCode, body: response.json<DecideResponse>() };
  };
  const confirm = (id: string, body: object, as: 'in' | 'solo' = 'in') =>
    app.inject({
      method: 'POST',
      url: `/v1/decisions/${id}/confirm`,
      headers: receiverAuth(as),
      payload: body
    });
  const seedTotal = (valuePaise: bigint) =>
    handle.db
      .insert(aggregate)
      .values({ agentID: seed.agents.resident, receiverID: seed.receivers.in, fy: FY, valuePaise });
  const pairValue = async () =>
    (
      await handle.db
        .select({ value: aggregate.valuePaise })
        .from(aggregate)
        .where(
          and(
            eq(aggregate.agentID, seed.agents.resident),
            eq(aggregate.receiverID, seed.receivers.in)
          )
        )
    )[0]?.value;

  beforeEach(async () => {
    handle = await testDb();
    seed = await seedParties(handle.db);
    const fx = demoFixedFx('88.40');
    if (!fx) throw new Error('fx');
    app = buildApp({
      logger: false,
      routes: [
        decisionRoutes({
          db: handle.db,
          pack: await loadTestPack(),
          rulepackHash: 'ab'.repeat(32),
          fx,
          network: 'testnet',
          pairSecret: 'pair-secret',
          paymentsTopicId: '0.0.7100',
          now: () => NOW
        })
      ]
    });
  });

  afterEach(async () => {
    await handle.close();
  });

  it('decides for a registered agent and logs the decision to HCS', async () => {
    const { status, body } = await decideFor({ identity: RESIDENT });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      rateBps: 0,
      valuePaise: '884',
      tdsMicroUsdc: '0',
      reason: 'under_threshold',
      hcsSequence: null
    });
    expect(body.decisionId).toMatch(/^dec_/);
    const [message] = await handle.db.select().from(hcsOutbox);
    expect(message).toMatchObject({ kind: 'decision', topicID: '0.0.7100' });
    expect(message?.payload).toMatchObject({ t: 'decision', did: body.decisionId, agg: '884' });
  });

  it('withholds 1% on the payment that crosses the threshold', async () => {
    await seedTotal(999_500n);
    const { body } = await decideFor({ identity: RESIDENT });
    expect(body).toMatchObject({
      rateBps: 100,
      tdsPaise: '9',
      tdsMicroUsdc: '1019',
      reason: 'threshold_crossed'
    });
  });

  it('holds an open decision, so of two near the threshold the second withholds', async () => {
    // ₹9,990: the first ₹8.84 stays under ₹10,000, the second crosses it
    await seedTotal(999_000n);
    expect((await decideFor({ identity: RESIDENT })).body.reason).toBe('under_threshold');
    expect((await decideFor({ identity: RESIDENT })).body.reason).toBe('threshold_crossed');
  });

  it("tracks a facilitator's own payer by its reference", async () => {
    const payer = { claims: { residency: 'resident', panOnFile: true }, reference: 'cust-42' };
    // ₹8,840 each: the second takes the pair past ₹10,000
    const big = { priceMicroUsdc: '100000000' };
    expect((await decideFor(payer, big)).body.reason).toBe('under_threshold');
    const second = await decideFor(payer, big);
    expect(second.body).toMatchObject({ reason: 'threshold_crossed', rateBps: 100 });
    const stored = await handle.db.select().from(decision);
    expect(stored.every((row) => row.agentID === null && row.payerReference === 'cust-42')).toBe(
      true
    );
  });

  it('registers an unknown account at Level 0 and refuses an unknown UAID', async () => {
    const unknown = await decideFor({ identity: 'hedera:testnet:0.0.6077' });
    expect(unknown.body.reason).toBe('within_tolerance');
    const [registered] = await handle.db
      .select()
      .from(agent)
      .where(eq(agent.identity, 'hedera:testnet:0.0.6077'));
    expect(registered).toMatchObject({ level: 0, reserveAccountID: null });

    const uaid = await decideFor({
      identity: 'uaid:aid:z6Mk9;uid=0;nativeId=hedera:testnet:0.0.6099'
    });
    expect(uaid.status).toBe(400);
  });

  it("confirms once, adding the value to the pair's total and logging it", async () => {
    await seedTotal(100_000n);
    const { body } = await decideFor({ identity: RESIDENT });
    const ref = { chain: 'eip155:8453', transactionRef: '0xabc123' };

    const confirmed = await confirm(body.decisionId, ref);
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ decisionId: body.decisionId, valuePaise: '884' });
    expect(await pairValue()).toBe(100_884n);
    const messages = await handle.db.select().from(hcsOutbox);
    expect(messages.map((row) => row.payload)).toContainEqual(
      expect.objectContaining({ t: 'decision_confirmed', did: body.decisionId, ref: '0xabc123' })
    );

    expect((await confirm(body.decisionId, ref)).statusCode).toBe(200);
    expect(await pairValue()).toBe(100_884n);
    expect((await confirm(body.decisionId, { ...ref, transactionRef: '0xdef' })).statusCode).toBe(
      409
    );
  });

  it('refuses a confirmation on another chain, for another receiver, or without a key', async () => {
    const { body } = await decideFor({ identity: RESIDENT });
    const ref = { chain: 'eip155:8453', transactionRef: '0xabc123' };
    expect((await confirm(body.decisionId, { ...ref, chain: 'hedera:testnet' })).statusCode).toBe(
      400
    );
    expect((await confirm(body.decisionId, ref, 'solo')).statusCode).toBe(404);
    const anonymous = await app.inject({
      method: 'POST',
      url: '/v1/decide',
      payload: { ...PRICE, payer: { identity: RESIDENT } }
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
