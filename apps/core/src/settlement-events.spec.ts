import type { DbHandle } from './db/client';
import { aggregate, payment, quote } from './db/schema';
import { testDb } from './db/test-db';
import { createEventBus, type EventBus } from './event-bus';
import { addPayment, FY, type LedgerSeed, loadTestPack, NOW, seedParties } from './ledger.fixture';
import { announceSettlement } from './settlement-events';
import type { StreamEvent } from '@kosha/shared/console-api';
import { accountIdSchema } from '@kosha/shared/ids';
import type { RulePack } from '@kosha/tax-engine/rule-pack';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('announceSettlement', () => {
  let handle: DbHandle;
  let seed: LedgerSeed;
  let pack: RulePack;
  let bus: EventBus;
  let events: StreamEvent[];

  // A settled payment worth `valuePaise` that leaves the pair at `afterPaise` for the year
  const settle = async (
    agent: keyof LedgerSeed['agents'],
    valuePaise: bigint,
    afterPaise: bigint,
    tdsMicro = 0n
  ) => {
    const agentId = seed.agents[agent];
    const receiverId = seed.receivers.in;
    const paymentId = await addPayment(handle.db, {
      receiverId,
      agentId,
      at: NOW,
      inrValuePaise: valuePaise,
      tdsMicro
    });
    await handle.db
      .insert(aggregate)
      .values({ agentID: agentId, receiverID: receiverId, fy: FY, valuePaise: afterPaise })
      .onConflictDoUpdate({
        target: [aggregate.agentID, aggregate.receiverID, aggregate.fy],
        set: { valuePaise: afterPaise }
      });
    const [row] = await handle.db
      .select({ quote })
      .from(payment)
      .innerJoin(quote, eq(quote.id, payment.quoteID))
      .where(eq(payment.id, paymentId));
    if (!row) throw new Error('payment missing');
    await announceSettlement(
      { db: handle.db, bus, pack, network: 'testnet' },
      {
        quote: row.quote,
        payer: accountIdSchema.parse('0.0.6001'),
        transactionId: '',
        paymentId,
        aggregatePaise: afterPaise
      }
    );
    return paymentId;
  };

  const typesOf = () => events.map((event) => event.type);

  beforeEach(async () => {
    handle = await testDb();
    seed = await seedParties(handle.db);
    pack = await loadTestPack();
    bus = createEventBus();
    events = [];
    bus.subscribe(seed.receivers.in, (event) => events.push(event));
  });

  afterEach(async () => {
    await handle.close();
  });

  it('sends the ledger row for a settled payment, to its receiver only', async () => {
    const others: StreamEvent[] = [];
    bus.subscribe(seed.receivers.solo, (event) => others.push(event));
    const paymentId = await settle('resident', 884n, 100_000n);

    expect(typesOf()).toEqual(['payment.settled']);
    expect(events[0]).toMatchObject({ type: 'payment.settled', row: { paymentId } });
    expect(others).toEqual([]);
  });

  it('reports the TDS reserved into the payer’s reserve', async () => {
    const paymentId = await settle('resident', 884n, 1_000_884n, 1_019n);
    expect(events[1]).toEqual({
      type: 'tds.withheld',
      paymentId,
      tdsMicro: '1019',
      reserveAccountId: '0.0.6101'
    });
  });

  it('sends threshold.near once, on the payment that reaches 90% of the threshold', async () => {
    // ₹8,995 → ₹9,005 of ₹10,000
    await settle('resident', 1_000n, 900_500n);
    expect(events.at(-1)).toEqual({
      type: 'threshold.near',
      receiverId: seed.receivers.in,
      agentId: seed.agents.resident,
      pct: 90.05,
      promptLevel1: false
    });

    events = [];
    await settle('resident', 1_000n, 901_500n);
    expect(typesOf()).toEqual(['payment.settled']);
  });

  it('measures a Level 0 payer against its tolerance and asks it to verify', async () => {
    // ₹4,491 → ₹4,500 of the ₹5,000 tolerance
    await settle('unknown', 884n, 450_000n);
    expect(events.at(-1)).toMatchObject({ type: 'threshold.near', pct: 90, promptLevel1: true });
  });
});
