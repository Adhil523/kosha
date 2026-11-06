import type { DbHandle } from './db/client';
import { receiver } from './db/schema';
import { testDb } from './db/test-db';
import { addPayment, type LedgerSeed, seedParties } from './ledger.fixture';
import {
  deductorRef,
  monthBounds,
  NO_TAN,
  previousMonthKey,
  readMonthlyClose
} from './monthly-close';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const NOVEMBER = monthBounds('2026-11');

describe('month helpers', () => {
  it('bounds a month at midnight IST', () => {
    expect(NOVEMBER).toEqual({
      start: new Date('2026-10-31T18:30:00Z'),
      end: new Date('2026-11-30T18:30:00Z')
    });
    expect(monthBounds('2026-13')).toBeNull();
    expect(monthBounds('nov')).toBeNull();
  });

  it('names the previous IST month, across a year end', () => {
    // 05:30 IST on 1 January
    expect(previousMonthKey(new Date('2026-01-01T00:00:00Z'))).toBe('2025-12');
    // 00:30 IST on 1 December, still 30 November in UTC
    expect(previousMonthKey(new Date('2026-11-30T19:00:00Z'))).toBe('2026-11');
  });

  it('masks the TAN', () => {
    expect(deductorRef('MUMD12345E')).toBe('MUMD*****E');
    expect(deductorRef(null)).toBe(NO_TAN);
  });
});

describe('readMonthlyClose', () => {
  let handle: DbHandle;
  let seed: LedgerSeed;

  beforeEach(async () => {
    handle = await testDb();
    seed = await seedParties(handle.db);
    await handle.db
      .update(receiver)
      .set({ tan: 'MUMD12345E' })
      .where(eq(receiver.id, seed.receivers.in));
  });

  afterEach(async () => {
    await handle.close();
  });

  it('totals the TDS per payer reserve for live settled payments in the month', async () => {
    if (!NOVEMBER) throw new Error('bad bounds');
    const inNovember = new Date('2026-11-06T10:30:00Z');
    const withheld = { receiverId: seed.receivers.in, at: inNovember, tdsMicro: 1_019n };
    await addPayment(handle.db, { ...withheld, agentId: seed.agents.resident });
    await addPayment(handle.db, { ...withheld, agentId: seed.agents.resident });
    await addPayment(handle.db, { ...withheld, agentId: seed.agents.unknown, tdsMicro: 20_023n });
    // Left out: no TDS, sample history, another month, not settled, another receiver
    await addPayment(handle.db, { ...withheld, agentId: seed.agents.resident, tdsMicro: 0n });
    await addPayment(handle.db, { ...withheld, agentId: seed.agents.resident, sample: true });
    await addPayment(handle.db, {
      ...withheld,
      agentId: seed.agents.resident,
      at: new Date('2026-10-31T18:29:59Z')
    });
    await addPayment(handle.db, { ...withheld, agentId: seed.agents.resident, status: 'pending' });
    await addPayment(handle.db, {
      ...withheld,
      receiverId: seed.receivers.solo,
      agentId: seed.agents.resident
    });

    const close = await readMonthlyClose(handle.db, seed.receivers.in, '2026-11', NOVEMBER);

    expect(close).toEqual({
      receiverId: seed.receivers.in,
      month: '2026-11',
      section: '393(1)',
      deductorRef: 'MUMD*****E',
      totalTdsPaise: '195',
      rows: [
        {
          agentId: seed.agents.resident,
          deducteeRef: '0.0.6***',
          tdsPaise: '18',
          tdsMicro: '2038',
          reserveAccountId: '0.0.6101'
        },
        {
          agentId: seed.agents.unknown,
          deducteeRef: 'PANNOTAVBL 0.0.6***',
          tdsPaise: '177',
          tdsMicro: '20023',
          reserveAccountId: '0.0.6101'
        }
      ]
    });
  });

  it('is empty for a quiet month and null for an unknown receiver', async () => {
    if (!NOVEMBER) throw new Error('bad bounds');
    const quiet = await readMonthlyClose(handle.db, seed.receivers.solo, '2026-11', NOVEMBER);
    expect(quiet).toMatchObject({ totalTdsPaise: '0', rows: [], deductorRef: NO_TAN });
    expect(await readMonthlyClose(handle.db, 'missing', '2026-11', NOVEMBER)).toBeNull();
  });
});
