import {
  fakeMirror,
  fakeScheduler,
  IDENTICAL_SCHEDULE,
  RELEASE_EXPIRES_AT,
  seedChallan
} from './close.fixture';
import type { DbHandle } from './db/client';
import { release } from './db/schema';
import { testDb } from './db/test-db';
import { type LedgerSeed, seedParties } from './ledger.fixture';
import { listReleases, refreshReleases, type ReleaseDeps, scheduleDue } from './releases';
import { PrivateKey, ScheduleCreateTransaction } from '@hiero-ledger/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CORE_KEY = PrivateKey.generateED25519().publicKey;
const NOW = new Date('2026-12-01T04:05:00Z');

describe('releases', () => {
  let handle: DbHandle;
  let seed: LedgerSeed;
  let challanId: string;

  const deps = (
    scheduler: ReturnType<typeof fakeScheduler>,
    mirror = fakeMirror({}),
    now = NOW
  ): ReleaseDeps => ({
    db: handle.db,
    execute: scheduler.execute,
    mirror,
    coreAccountId: '0.0.4000',
    coreKey: CORE_KEY,
    settlementTokenId: '0.0.429274',
    maxTransactionFeeHbar: '2',
    now: () => now
  });
  const stored = () => handle.db.select().from(release).orderBy(release.createdAt);

  beforeEach(async () => {
    handle = await testDb();
    seed = await seedParties(handle.db);
  });

  afterEach(async () => {
    await handle.close();
  });

  it('schedules each pending release: reserve → deductor, with the release memo', async () => {
    ({ challanId } = await seedChallan(handle.db, seed.receivers.in, [
      { agentId: seed.agents.resident, micro: 2_038n },
      { agentId: seed.agents.unknown, micro: 20_023n }
    ]));
    const scheduler = fakeScheduler();

    expect(await scheduleDue(deps(scheduler), { challanId })).toEqual({ changed: 2, failed: 0 });

    const [first] = scheduler.seen;
    expect(first).toBeInstanceOf(ScheduleCreateTransaction);
    if (!(first instanceof ScheduleCreateTransaction)) return;
    expect(first.getScheduleMemo).toBe(`kosha-release:2026-11:${seed.agents.resident}`);
    expect(first.expirationTime?.toDate()).toEqual(RELEASE_EXPIRES_AT);
    expect(first.payerAccountId?.toString()).toBe('0.0.4000');
    expect(await stored()).toMatchObject([
      { status: 'scheduled', scheduleID: '0.0.901' },
      { status: 'scheduled', scheduleID: '0.0.902' }
    ]);
    expect(await listReleases(handle.db, { receiverId: seed.receivers.in })).toMatchObject([
      { agentId: seed.agents.resident, micro: '2038', scheduleId: '0.0.901', status: 'scheduled' },
      { agentId: seed.agents.unknown, micro: '20023', scheduleId: '0.0.902' }
    ]);
  });

  it('keeps the existing schedule on a retry, leaves a rejected one pending, expires a late one', async () => {
    ({ challanId } = await seedChallan(handle.db, seed.receivers.in, [
      { agentId: seed.agents.resident, micro: 2_038n },
      { agentId: seed.agents.unknown, micro: 20_023n }
    ]));
    const refused = fakeScheduler(IDENTICAL_SCHEDULE, {
      ok: false,
      data: { status: 'INSUFFICIENT_PAYER_BALANCE', receipt: null }
    });
    expect(await scheduleDue(deps(refused), { challanId })).toEqual({ changed: 1, failed: 1 });
    expect(await stored()).toMatchObject([
      { status: 'scheduled', scheduleID: '0.0.8001' },
      { status: 'pending', scheduleID: null }
    ]);

    const late = new Date(RELEASE_EXPIRES_AT.getTime() + 1000);
    expect(await scheduleDue(deps(fakeScheduler(), undefined, late), { challanId })).toEqual({
      changed: 1,
      failed: 0
    });
    expect((await stored())[1]).toMatchObject({ status: 'expired' });
  });

  it('refreshes scheduled releases from the Mirror Node', async () => {
    ({ challanId } = await seedChallan(handle.db, seed.receivers.in, [
      { agentId: seed.agents.resident, micro: 2_038n, status: 'scheduled' },
      { agentId: seed.agents.unknown, micro: 20_023n, status: 'scheduled' }
    ]));
    const mirror = fakeMirror({ '0.0.800': 'executed', '0.0.801': 'missing' });

    expect(await refreshReleases(deps(fakeScheduler(), mirror), { challanId })).toEqual({
      changed: 1,
      failed: 0
    });
    expect(await stored()).toMatchObject([
      { status: 'executed', executedAt: new Date('2026-12-01T04:06:00Z') },
      { status: 'scheduled' }
    ]);

    const late = new Date(RELEASE_EXPIRES_AT.getTime() + 1000);
    const unsigned = fakeMirror({ '0.0.801': 'pending' });
    await refreshReleases(deps(fakeScheduler(), unsigned, late), { challanId });
    expect((await stored())[1]).toMatchObject({ status: 'expired' });
  });
});
