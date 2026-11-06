import { fakeMirror, fakeScheduler, seedChallan, signedScheduleSign } from './close.fixture';
import type { DbHandle } from './db/client';
import { testDb } from './db/test-db';
import { type LedgerSeed, seedParties } from './ledger.fixture';
import { cosignRelease } from './release-cosign';
import type { ReleaseDeps } from './releases';
import { PrivateKey, ScheduleSignTransaction } from '@hiero-ledger/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CORE_KEY = PrivateKey.generateED25519().publicKey;

describe('cosignRelease', () => {
  let handle: DbHandle;
  let seed: LedgerSeed;
  let releaseIds: string[];
  let scheduler: ReturnType<typeof fakeScheduler>;

  const deps = (mirror = fakeMirror({ '0.0.800': 'executed' })): ReleaseDeps => ({
    db: handle.db,
    execute: scheduler.execute,
    mirror,
    coreAccountId: '0.0.4000',
    coreKey: CORE_KEY,
    settlementTokenId: '0.0.429274',
    maxTransactionFeeHbar: '2',
    now: () => new Date('2026-12-01T05:00:00Z')
  });

  beforeEach(async () => {
    handle = await testDb();
    seed = await seedParties(handle.db);
    scheduler = fakeScheduler();
    ({ releaseIds } = await seedChallan(handle.db, seed.receivers.in, [
      { agentId: seed.agents.resident, micro: 2_038n, status: 'scheduled' },
      { agentId: seed.agents.unknown, micro: 20_023n }
    ]));
  });

  afterEach(async () => {
    await handle.close();
  });

  it('relays the signature and reports the executed transfer', async () => {
    const [id = ''] = releaseIds;
    const transaction = await signedScheduleSign('0.0.800');

    const result = await cosignRelease(deps(), {}, id, { transaction });

    expect(result).toMatchObject({
      ok: true,
      data: { id, status: 'executed', scheduleId: '0.0.800', cosignedBy: '0.0.6001' }
    });
    expect(scheduler.seen[0]).toBeInstanceOf(ScheduleSignTransaction);
    // The Mirror Node has not caught up: still scheduled, but co-signed
    const lagging = await cosignRelease(deps(fakeMirror({})), {}, id, { transaction });
    expect(lagging).toMatchObject({ ok: false, data: { status: 409 } });
  });

  it('refuses the wrong schedule, bad bytes, a pending release and another receiver', async () => {
    const [scheduled = '', pending = ''] = releaseIds;
    const other = { transaction: await signedScheduleSign('0.0.801') };
    expect(await cosignRelease(deps(), {}, scheduled, other)).toMatchObject({
      ok: false,
      data: { status: 400, message: 'the transaction signs 0.0.801' }
    });
    expect(await cosignRelease(deps(), {}, scheduled, { transaction: 'AAAA' })).toMatchObject({
      ok: false,
      data: { status: 400 }
    });
    expect(await cosignRelease(deps(), {}, pending, other)).toMatchObject({
      ok: false,
      data: { status: 409, message: 'the release is pending' }
    });
    const solo = { receiverId: seed.receivers.solo };
    expect(await cosignRelease(deps(), solo, scheduled, other)).toMatchObject({
      ok: false,
      data: { status: 404 }
    });
    expect(scheduler.seen).toHaveLength(0);
  });

  it('passes the network status through when the signature is refused', async () => {
    scheduler = fakeScheduler({
      ok: false,
      data: { status: 'INVALID_SIGNATURE', receipt: null }
    });
    const [id = ''] = releaseIds;
    const result = await cosignRelease(deps(), {}, id, {
      transaction: await signedScheduleSign('0.0.800')
    });
    expect(result).toMatchObject({
      ok: false,
      data: { status: 502, message: 'the network refused the signature: INVALID_SIGNATURE' }
    });
  });
});
