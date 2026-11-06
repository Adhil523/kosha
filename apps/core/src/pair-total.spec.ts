import type { DbHandle } from './db/client';
import { agent, aggregate, decision, payment, quote, receiver } from './db/schema';
import { testDb } from './db/test-db';
import { pairTotalPaise, withPairLock } from './pair-total';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const NOW = new Date('2026-11-06T10:30:00Z');

describe('pairTotalPaise', () => {
  let handle: DbHandle;
  let pair: { agentId: string; receiverId: string; fy: string };

  const openQuote = (inrValuePaise: bigint, fields: Record<string, unknown> = {}) => ({
    scheme: 'kosha_split' as const,
    receiverID: pair.receiverId,
    agentID: pair.agentId,
    resource: 'https://api.demo-in.dev/v1/gst-lookup',
    payToAccountID: '0.0.5001',
    priceMicro: 100000n,
    tdsMicro: 0n,
    totalMicro: 100000n,
    inrValuePaise,
    rateBps: 0,
    reason: 'under_threshold',
    rulepack: 'in-2026.2',
    inrPerUsdMicro: 88_400_000n,
    nodeAccountIDs: ['0.0.3'],
    fy: '2026-27',
    expiresAt: new Date(NOW.getTime() + 60_000),
    ...fields
  });

  // What the ledger writes once a settlement's outcome is known
  const recordedPayment = (quoteID: string, transactionID: string) => ({
    quoteID,
    transactionID,
    receiverID: pair.receiverId,
    agentID: pair.agentId,
    priceMicro: 100000n,
    tdsMicro: 0n,
    inrValuePaise: 884n,
    fy: '2026-27',
    status: 'settled' as const
  });

  beforeAll(async () => {
    handle = await testDb();
    const [createdReceiver] = await handle.db
      .insert(receiver)
      .values({
        legalName: 'Demo',
        residency: 'resident',
        specifiedPerson: false,
        mode: 'threshold',
        unverifiedPolicy: 'threshold_tolerant',
        apiKeyHash: 'h'
      })
      .returning();
    const [createdAgent] = await handle.db
      .insert(agent)
      .values({ identity: 'hedera:testnet:0.0.6001' })
      .returning();
    pair = {
      agentId: createdAgent?.id ?? '',
      receiverId: createdReceiver?.id ?? '',
      fy: '2026-27'
    };
  });

  afterAll(async () => {
    await handle.close();
  });

  it('is zero for a new pair', async () => {
    expect(await pairTotalPaise(handle.db, pair, NOW)).toBe(0n);
  });

  it('adds settled, outside and open-quote value, and ignores recorded, expired and other-year quotes', async () => {
    await handle.db.insert(aggregate).values({
      agentID: pair.agentId,
      receiverID: pair.receiverId,
      fy: '2026-27',
      valuePaise: 998_000n,
      outsideValuePaise: 1_000n
    });
    const [, recorded] = await handle.db
      .insert(quote)
      .values([
        openQuote(884n),
        openQuote(884n, { usedTransactionID: '0.0.4000@1.1' }),
        openQuote(884n, { expiresAt: new Date(NOW.getTime() - 1) }),
        openQuote(884n, { fy: '2025-26' })
      ])
      .returning({ id: quote.id });
    await handle.db.insert(payment).values(recordedPayment(recorded?.id ?? '', '0.0.4000@1.1'));

    expect(await pairTotalPaise(handle.db, pair, NOW)).toBe(998_000n + 1_000n + 884n);
  });

  it('counts a claimed quote until its payment is recorded, even past expiry', async () => {
    const before = await pairTotalPaise(handle.db, pair, NOW);
    // Settle has claimed it and is executing on Hedera; the aggregate doesn't include it yet
    const [inFlight] = await handle.db
      .insert(quote)
      .values(
        openQuote(500n, {
          usedTransactionID: '0.0.4000@2.2',
          expiresAt: new Date(NOW.getTime() - 1)
        })
      )
      .returning({ id: quote.id });

    expect(await pairTotalPaise(handle.db, pair, NOW)).toBe(before + 500n);

    await handle.db.insert(payment).values(recordedPayment(inFlight?.id ?? '', '0.0.4000@2.2'));
    expect(await pairTotalPaise(handle.db, pair, NOW)).toBe(before);
  });

  it('lets a quote written under the lock be seen by the next locked read', async () => {
    const before = await pairTotalPaise(handle.db, pair, NOW);
    const quoteUnderLock = () =>
      withPairLock(handle.db, pair, async (tx) => {
        const total = await pairTotalPaise(tx, pair, NOW);
        await tx.insert(quote).values(openQuote(100n));
        return total;
      });

    const totals = await Promise.all([quoteUnderLock(), quoteUnderLock()]);

    expect([...totals].sort()).toEqual([before, before + 100n]);
  });

  it('holds an open decision for another rail, but not a confirmed or expired one', async () => {
    const before = await pairTotalPaise(handle.db, pair, NOW);
    const decided = (valuePaise: bigint, fields: Record<string, unknown> = {}) => ({
      receiverID: pair.receiverId,
      agentID: pair.agentId,
      chain: 'eip155:8453',
      priceMicro: 100000n,
      inrPerUsdMicro: 88_400_000n,
      valuePaise,
      tdsPaise: 0n,
      tdsMicro: 0n,
      rateBps: 0,
      reason: 'under_threshold',
      flags: [],
      rulepack: 'in-2026.2',
      fy: '2026-27',
      expiresAt: new Date(NOW.getTime() + 60_000),
      ...fields
    });
    await handle.db
      .insert(decision)
      .values([
        decided(300n),
        decided(50n, { confirmedAt: NOW, transactionRef: '0xabc' }),
        decided(70n, { expiresAt: new Date(NOW.getTime() - 1) })
      ]);

    expect(await pairTotalPaise(handle.db, pair, NOW)).toBe(before + 300n);
  });
});
