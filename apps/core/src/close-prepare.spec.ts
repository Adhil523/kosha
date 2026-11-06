import { fakeMirror, fakeScheduler, seedChallan } from './close.fixture';
import { prepareMonthlyClose } from './close-prepare';
import type { DbHandle } from './db/client';
import { release } from './db/schema';
import { testDb } from './db/test-db';
import { addPayment, type LedgerSeed, seedParties } from './ledger.fixture';
import { PrivateKey } from '@hiero-ledger/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CORE_KEY = PrivateKey.generateED25519().publicKey;
// 06:30 IST on 1 December: the job's first run after November
const FIRST_OF_DECEMBER = new Date('2026-12-01T01:00:00Z');

describe('prepareMonthlyClose', () => {
  let handle: DbHandle;
  let seed: LedgerSeed;

  beforeEach(async () => {
    handle = await testDb();
    seed = await seedParties(handle.db);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await handle.close();
  });

  it('names the receivers that owe a challan and settles earlier releases', async () => {
    await addPayment(handle.db, {
      receiverId: seed.receivers.in,
      agentId: seed.agents.resident,
      at: new Date('2026-11-20T10:00:00Z'),
      tdsMicro: 1_019n
    });
    // October's close: one release still pending, one co-signed since
    await seedChallan(handle.db, seed.receivers.solo, [
      { agentId: seed.agents.resident, micro: 2_038n },
      { agentId: seed.agents.unknown, micro: 20_023n, status: 'scheduled' }
    ]);

    const report = await prepareMonthlyClose({
      db: handle.db,
      releases: {
        db: handle.db,
        execute: fakeScheduler().execute,
        mirror: fakeMirror({ '0.0.801': 'executed' }),
        coreAccountId: '0.0.4000',
        coreKey: CORE_KEY,
        settlementTokenId: '0.0.429274',
        maxTransactionFeeHbar: '2',
        now: () => FIRST_OF_DECEMBER
      },
      now: () => FIRST_OF_DECEMBER
    });

    expect(report).toEqual({
      month: '2026-11',
      receivers: 2,
      awaitingChallan: 1,
      scheduled: { changed: 1, failed: 0 },
      refreshed: { changed: 1, failed: 0 }
    });
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining(`2026-11 ${seed.receivers.in}: ₹0.09 of TDS`)
    );
    expect(await handle.db.select().from(release)).toMatchObject([
      { status: 'scheduled', scheduleID: '0.0.901' },
      { status: 'executed' }
    ]);
  });
});
