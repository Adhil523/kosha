import { buildApp } from './app';
import type { DbHandle } from './db/client';
import { payment } from './db/schema';
import { testDb } from './db/test-db';
import { exportRoutes } from './export-routes';
import {
  addPayment,
  ADMIN,
  ADMIN_TOKEN,
  type LedgerSeed,
  receiverAuth,
  seedParties
} from './ledger.fixture';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The expected file, byte for byte. Q3 of 2026-27 is Oct–Dec 2026 in IST.
const GOLDEN = [
  'deducteeRef,considerationPaise,tdsPaise,rateBps,fundedBy,paymentDate,deductionDate,section,hcsSequence,transactionId',
  '0.0.6***,88400,884,100,deductee_reserve,2026-10-01,2026-10-01,393(1),41,0.0.6001@1762425001.000000000',
  '0.0.6***,884,9,100,deductee_reserve,2026-11-06,2026-11-06,393(1),,0.0.6001@1762425002.000000000',
  'PANNOTAVBL 0.0.6***,884,177,2000,deductee_reserve,2026-12-31,2026-12-31,393(1),,0.0.6001@1762425003.000000000',
  ''
].join('\r\n');

describe('GET /v1/exports/tds', () => {
  let handle: DbHandle;
  let app: ReturnType<typeof buildApp>;
  let seed: LedgerSeed;

  const download = (query: string, headers: Record<string, string> = ADMIN) =>
    app.inject({ method: 'GET', url: `/v1/exports/tds?${query}`, headers });

  beforeAll(async () => {
    handle = await testDb();
    seed = await seedParties(handle.db);
    const { agents, receivers } = seed;
    const withheld = { receiverId: receivers.in, agentId: agents.resident, rateBps: 100 };
    // In the quarter: 1% on ₹884 (just after midnight IST on 1 Oct), 1% on ₹8.84, 20% on ₹8.84
    const first = await addPayment(handle.db, {
      ...withheld,
      at: new Date('2026-09-30T18:30:00Z'),
      inrValuePaise: 88_400n,
      tdsMicro: 100_000n
    });
    await handle.db.update(payment).set({ hcsSequence: 41 }).where(eq(payment.id, first));
    await addPayment(handle.db, {
      ...withheld,
      at: new Date('2026-11-06T10:30:00Z'),
      tdsMicro: 1_019n
    });
    await addPayment(handle.db, {
      receiverId: receivers.in,
      agentId: agents.unknown,
      at: new Date('2026-12-31T18:29:59Z'),
      tdsMicro: 20_023n,
      rateBps: 2000
    });
    // Left out: no TDS, sample history, still pending, another receiver, and the next quarter
    const at = new Date('2026-11-07T10:30:00Z');
    await addPayment(handle.db, { receiverId: receivers.in, agentId: agents.resident, at });
    await addPayment(handle.db, { ...withheld, at, tdsMicro: 1_019n, sample: true });
    await addPayment(handle.db, { ...withheld, at, tdsMicro: 1_019n, status: 'pending' });
    await addPayment(handle.db, { ...withheld, at, tdsMicro: 1_019n, receiverId: receivers.solo });
    await addPayment(handle.db, {
      ...withheld,
      at: new Date('2026-12-31T18:30:00Z'),
      tdsMicro: 1_019n
    });
    app = buildApp({
      logger: false,
      routes: [
        exportRoutes({ db: handle.db, adminToken: ADMIN_TOKEN, financialYearStart: '04-01' })
      ]
    });
  });

  afterAll(async () => {
    await handle.close();
  });

  it("downloads the receiver's quarter as the golden CSV", async () => {
    const response = await download(`receiverId=${seed.receivers.in}&quarter=2026-Q3`);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="kosha-tds-2026-Q3.csv"'
    );
    expect(response.body).toBe(GOLDEN);
  });

  it('lets a receiver download its own file without naming itself', async () => {
    const response = await download('quarter=2026-Q3', receiverAuth('in'));
    expect(response.body).toBe(GOLDEN);
  });

  it("refuses another receiver's file, a missing receiver and a bad quarter", async () => {
    const other = await download(
      `receiverId=${seed.receivers.in}&quarter=2026-Q3`,
      receiverAuth('solo')
    );
    expect(other.statusCode).toBe(403);
    expect((await download('quarter=2026-Q3')).statusCode).toBe(400);
    expect((await download(`receiverId=${seed.receivers.in}&quarter=2026-Q5`)).statusCode).toBe(
      400
    );
    expect((await download('quarter=2026-Q3', {})).statusCode).toBe(401);
  });
});
