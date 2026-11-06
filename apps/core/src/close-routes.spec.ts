import { buildApp } from './app';
import { fakeMirror, fakeScheduler, signedScheduleSign } from './close.fixture';
import { closeRoutes } from './close-routes';
import type { DbHandle } from './db/client';
import { receiverWallet } from './db/schema';
import { testDb } from './db/test-db';
import {
  addPayment,
  ADMIN,
  ADMIN_TOKEN,
  type LedgerSeed,
  receiverAuth,
  seedParties
} from './ledger.fixture';
import { PrivateKey } from '@hiero-ledger/sdk';
import type { ChallanRow, MonthlyClose, ReleaseRow } from '@kosha/shared/tax-reports';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CORE_KEY = PrivateKey.generateED25519().publicKey;
type Recorded = { challan: ChallanRow; releases: ReleaseRow[] };

describe('monthly close routes', () => {
  let handle: DbHandle;
  let app: ReturnType<typeof buildApp>;
  let seed: LedgerSeed;
  let mirror: ReturnType<typeof fakeMirror>;

  const get = (url: string, headers: Record<string, string> = ADMIN) =>
    app.inject({ method: 'GET', url, headers });
  const post = (url: string, payload: object, headers: Record<string, string> = ADMIN) =>
    app.inject({ method: 'POST', url, headers, payload });
  const record = (receiverId: string, headers?: Record<string, string>) =>
    post('/v1/challans', { receiverId, month: '2026-11', challanRef: 'CIN-1' }, headers);

  beforeEach(async () => {
    handle = await testDb();
    seed = await seedParties(handle.db);
    mirror = fakeMirror({});
    await handle.db.insert(receiverWallet).values({
      receiverID: seed.receivers.in,
      accountID: '0.0.5001',
      proofSignature: 'ab',
      verifiedAt: new Date('2026-11-01T00:00:00Z')
    });
    const withheld = { receiverId: seed.receivers.in, at: new Date('2026-11-06T10:30:00Z') };
    await addPayment(handle.db, { ...withheld, agentId: seed.agents.resident, tdsMicro: 1_019n });
    await addPayment(handle.db, { ...withheld, agentId: seed.agents.unknown, tdsMicro: 20_023n });
    const releases = {
      db: handle.db,
      execute: fakeScheduler().execute,
      mirror: {
        scheduleStatus: (id: string) => mirror.scheduleStatus(id),
        transactionAt: (timestamp: string) => mirror.transactionAt(timestamp)
      },
      coreAccountId: '0.0.4000',
      coreKey: CORE_KEY,
      settlementTokenId: '0.0.429274',
      maxTransactionFeeHbar: '2'
    };
    app = buildApp({
      logger: false,
      routes: [
        closeRoutes({
          db: handle.db,
          adminToken: ADMIN_TOKEN,
          challan: {
            db: handle.db,
            pairSecret: 'pair-secret',
            paymentsTopicId: '0.0.7100',
            releases
          }
        })
      ]
    });
  });

  afterEach(async () => {
    await handle.close();
  });

  it('serves the close to the admin and to the receiver itself', async () => {
    const asAdmin = await get(`/v1/close?receiverId=${seed.receivers.in}&month=2026-11`);
    expect(asAdmin.statusCode).toBe(200);
    expect(asAdmin.json<MonthlyClose>()).toMatchObject({ totalTdsPaise: '186', rows: [{}, {}] });

    const own = await get('/v1/close?month=2026-11', receiverAuth('in'));
    expect(own.json<MonthlyClose>().totalTdsPaise).toBe('186');
    const other = await get(
      `/v1/close?receiverId=${seed.receivers.in}&month=2026-11`,
      receiverAuth('solo')
    );
    expect(other.statusCode).toBe(403);
    expect((await get('/v1/close?month=2026-11')).statusCode).toBe(400);
    expect((await get('/v1/close?receiverId=missing&month=2026-11')).statusCode).toBe(404);
    expect(
      (await get('/v1/close?month=2026-11', { authorization: 'Bearer nope' })).statusCode
    ).toBe(401);
  });

  it('records the challan, lists it, and shows the scheduled releases', async () => {
    const recorded = await record(seed.receivers.in);
    expect(recorded.statusCode).toBe(201);
    const { challan, releases } = recorded.json<Recorded>();
    expect(challan).toMatchObject({ month: '2026-11', tdsPaise: '186' });
    expect(releases).toMatchObject([{ status: 'scheduled' }, { status: 'scheduled' }]);

    expect((await get('/v1/challans', receiverAuth('in'))).json<ChallanRow[]>()).toMatchObject([
      { id: challan.id }
    ]);
    expect((await get('/v1/challans', receiverAuth('solo'))).json()).toEqual([]);
    expect((await record(seed.receivers.in)).statusCode).toBe(409);
    expect((await record(seed.receivers.in, receiverAuth('solo'))).statusCode).toBe(403);

    mirror = fakeMirror({ '0.0.901': 'executed' });
    const listed = await get(`/v1/releases?challanId=${challan.id}`, receiverAuth('in'));
    expect(listed.json<ReleaseRow[]>()).toMatchObject([
      { status: 'executed', scheduleId: '0.0.901' },
      { status: 'scheduled', scheduleId: '0.0.902' }
    ]);
    expect((await get('/v1/releases', receiverAuth('solo'))).json()).toEqual([]);
  });

  it('co-signs a release', async () => {
    const { releases } = (await record(seed.receivers.in)).json<Recorded>();
    const [first = { id: '', scheduleId: '' }] = releases;
    mirror = fakeMirror({ '0.0.901': 'executed' });

    const signed = await post(`/v1/releases/${first.id}/cosign`, {
      transaction: await signedScheduleSign(first.scheduleId ?? '')
    });
    expect(signed.statusCode).toBe(200);
    expect(signed.json<ReleaseRow>()).toMatchObject({ status: 'executed', cosignedBy: '0.0.6001' });

    const again = await post(`/v1/releases/${first.id}/cosign`, { transaction: 'AAAA' });
    expect(again.statusCode).toBe(409);
    expect((await post('/v1/releases/missing/cosign', { transaction: 'AAAA' })).statusCode).toBe(
      404
    );
  });
});
