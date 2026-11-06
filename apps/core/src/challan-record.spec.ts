import { type ChallanDeps, hashChallanRef, listChallans, recordChallan } from './challan-record';
import { fakeMirror, fakeScheduler, RECORDED_AT } from './close.fixture';
import type { DbHandle } from './db/client';
import { hcsOutbox, receiverWallet, release } from './db/schema';
import { testDb } from './db/test-db';
import { addPayment, type LedgerSeed, seedParties } from './ledger.fixture';
import { PrivateKey } from '@hiero-ledger/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CORE_KEY = PrivateKey.generateED25519().publicKey;

describe('recordChallan', () => {
  let handle: DbHandle;
  let seed: LedgerSeed;
  let scheduler: ReturnType<typeof fakeScheduler>;

  const deps = (): ChallanDeps => ({
    db: handle.db,
    pairSecret: 'pair-secret',
    paymentsTopicId: '0.0.7100',
    releases: {
      db: handle.db,
      execute: scheduler.execute,
      mirror: fakeMirror({}),
      coreAccountId: '0.0.4000',
      coreKey: CORE_KEY,
      settlementTokenId: '0.0.429274',
      maxTransactionFeeHbar: '2',
      now: () => RECORDED_AT
    }
  });
  const record = (receiverId: string, month = '2026-11') =>
    recordChallan(deps(), { receiverId, month, challanRef: 'CIN-2026-11-0001' }, RECORDED_AT);

  beforeEach(async () => {
    handle = await testDb();
    seed = await seedParties(handle.db);
    scheduler = fakeScheduler();
    await handle.db.insert(receiverWallet).values({
      receiverID: seed.receivers.in,
      accountID: '0.0.5001',
      proofSignature: 'ab',
      verifiedAt: RECORDED_AT
    });
    const withheld = { receiverId: seed.receivers.in, at: new Date('2026-11-06T10:30:00Z') };
    await addPayment(handle.db, { ...withheld, agentId: seed.agents.resident, tdsMicro: 1_019n });
    await addPayment(handle.db, { ...withheld, agentId: seed.agents.resident, tdsMicro: 1_019n });
    await addPayment(handle.db, { ...withheld, agentId: seed.agents.unknown, tdsMicro: 20_023n });
  });

  afterEach(async () => {
    await handle.close();
  });

  it('stores the hash, logs the challan to HCS and schedules one release per payer', async () => {
    const result = await record(seed.receivers.in);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.challan).toMatchObject({
      receiverId: seed.receivers.in,
      month: '2026-11',
      tdsPaise: '195',
      recordedAt: '2026-12-01T04:00:00.000Z',
      hcsSequence: null
    });
    expect(result.data.releases).toMatchObject([
      { agentId: seed.agents.resident, micro: '2038', status: 'scheduled', scheduleId: '0.0.901' },
      { agentId: seed.agents.unknown, micro: '20023', status: 'scheduled', scheduleId: '0.0.902' }
    ]);
    expect(await handle.db.select().from(release)).toMatchObject([
      { toAccountID: '0.0.5001', expiresAt: new Date('2026-12-08T04:00:00Z') },
      { toAccountID: '0.0.5001' }
    ]);
    const [message] = await handle.db.select().from(hcsOutbox);
    expect(message?.payload).toEqual({
      v: 2,
      t: 'challan',
      cid: result.data.challan.id,
      rcv: expect.stringMatching(/^[0-9a-f]{32}$/),
      month: '2026-11',
      tds: '195',
      hash: hashChallanRef('CIN-2026-11-0001')
    });
    expect(JSON.stringify(message?.payload)).not.toContain('CIN-2026');
    expect(await listChallans(handle.db, seed.receivers.in)).toMatchObject([{ tdsPaise: '195' }]);
    expect(await listChallans(handle.db, seed.receivers.solo)).toEqual([]);
  });

  it('closes a month once, and refuses a month with nothing to release', async () => {
    expect((await record(seed.receivers.in)).ok).toBe(true);
    expect(await record(seed.receivers.in)).toMatchObject({ ok: false, data: { status: 409 } });
    expect(await record(seed.receivers.in, '2026-10')).toMatchObject({
      ok: false,
      data: { status: 400, message: 'no TDS was withheld in 2026-10' }
    });
    expect(scheduler.seen).toHaveLength(2);
  });

  it('needs a known receiver with a wallet', async () => {
    expect(await record('missing')).toMatchObject({ ok: false, data: { status: 404 } });
    expect(await record(seed.receivers.solo)).toMatchObject({
      ok: false,
      data: { status: 400, message: 'the receiver has no wallet to release to' }
    });
  });
});
