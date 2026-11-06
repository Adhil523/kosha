import { committedSpend, istDayStart } from './agent-spend';
import type { DbHandle } from './db/client';
import { agent, payment, quote, receiver } from './db/schema';
import { testDb } from './db/test-db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// 16:00 IST on 6 Nov 2026; the IST day began at 18:30 UTC on 5 Nov
const NOW = new Date('2026-11-06T10:30:00Z');
const FY = '2026-27';

describe('committedSpend', () => {
  let handle: DbHandle;
  let agentId = '';
  let receiverId = '';

  const addQuote = async (totalMicro: bigint, fields: Record<string, unknown> = {}) => {
    const [row] = await handle.db
      .insert(quote)
      .values({
        scheme: 'kosha_split',
        receiverID: receiverId,
        agentID: agentId,
        resource: 'https://api.demo-in.dev/v1/gst-lookup',
        payToAccountID: '0.0.5001',
        priceMicro: totalMicro,
        tdsMicro: 0n,
        totalMicro,
        inrValuePaise: 884n,
        rateBps: 0,
        reason: 'under_threshold',
        rulepack: 'in-2026.2',
        inrPerUsdMicro: 88_400_000n,
        nodeAccountIDs: ['0.0.3'],
        fy: FY,
        createdAt: new Date(NOW.getTime() - 60_000),
        expiresAt: new Date(NOW.getTime() + 60_000),
        ...fields
      })
      .returning({ id: quote.id });
    return row?.id ?? '';
  };

  const pay = (quoteID: string, status: 'settled' | 'pending' | 'failed', sample = false) =>
    handle.db.insert(payment).values({
      quoteID,
      transactionID: `0.0.6001@${quoteID}`,
      receiverID: receiverId,
      agentID: agentId,
      priceMicro: 0n,
      tdsMicro: 0n,
      inrValuePaise: 0n,
      fy: FY,
      status,
      sample
    });

  const spend = (excludeQuoteId?: string) =>
    committedSpend(handle.db, { agentId, fy: FY, now: NOW, excludeQuoteId });

  beforeAll(async () => {
    handle = await testDb();
    const [payee] = await handle.db
      .insert(receiver)
      .values({
        legalName: 'Demo Data Pvt Ltd',
        residency: 'resident',
        specifiedPerson: false,
        mode: 'threshold',
        unverifiedPolicy: 'threshold_tolerant',
        apiKeyHash: 'hash'
      })
      .returning({ id: receiver.id });
    const [payer] = await handle.db
      .insert(agent)
      .values({ identity: 'hedera:testnet:0.0.6001' })
      .returning({ id: agent.id });
    receiverId = payee?.id ?? '';
    agentId = payer?.id ?? '';
  });

  afterAll(async () => {
    await handle.close();
  });

  it('starts the day at midnight IST', () => {
    expect(istDayStart(NOW).toISOString()).toBe('2026-11-05T18:30:00.000Z');
  });

  it('counts nothing for a new agent', async () => {
    expect(await spend()).toEqual({ dayMicro: 0n, fyMicro: 0n });
  });

  it('counts settled, in-flight and open quotes, but not failed or expired ones', async () => {
    await pay(await addQuote(100n, { usedTransactionID: 'tx-settled' }), 'settled');
    await pay(await addQuote(20n, { usedTransactionID: 'tx-pending' }), 'pending');
    await pay(await addQuote(9_000n, { usedTransactionID: 'tx-failed' }), 'failed');
    // Claimed and executing: no payment row yet, and past its expiry
    await addQuote(3n, { usedTransactionID: 'tx-claimed', expiresAt: new Date(NOW.getTime() - 1) });
    const open = await addQuote(4n);
    await addQuote(50_000n, { expiresAt: new Date(NOW.getTime() - 1) });

    expect(await spend()).toEqual({ dayMicro: 127n, fyMicro: 127n });
    expect(await spend(open)).toEqual({ dayMicro: 123n, fyMicro: 123n });
  });

  it('counts yesterday toward the year but not the day', async () => {
    const yesterday = new Date('2026-11-05T18:29:59Z');
    await pay(
      await addQuote(1_000n, { createdAt: yesterday, usedTransactionID: 'tx-old' }),
      'settled'
    );

    expect(await spend()).toEqual({ dayMicro: 127n, fyMicro: 1_127n });
  });

  it('leaves out another financial year', async () => {
    await pay(
      await addQuote(7_000n, { fy: '2025-26', usedTransactionID: 'tx-last-fy' }),
      'settled'
    );

    expect((await spend()).fyMicro).toBe(1_127n);
  });

  it('leaves out seeded sample history', async () => {
    await pay(await addQuote(5_000n, { usedTransactionID: 'tx-sample' }), 'settled', true);

    expect((await spend()).fyMicro).toBe(1_127n);
  });
});
