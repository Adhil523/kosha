import { buildApp } from './app';
import type { DbHandle } from './db/client';
import { agentWallet, aggregate, payment, receiverWallet } from './db/schema';
import { testDb } from './db/test-db';
import { demoRoutes } from './demo-routes';
import { demoFixedFx } from './fx';
import { ADMIN, ADMIN_TOKEN, type LedgerSeed, loadTestPack, seedParties } from './ledger.fixture';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const RESIDENT = 'hedera:testnet:0.0.6001';
const UNKNOWN = 'hedera:testnet:0.0.6003';
const RECEIVER_IN = '0.0.5001';

const sample = (key: string, at: string, priceMicroUsdc: string, agent = RESIDENT) => ({
  key,
  agent,
  receiverAccountId: RECEIVER_IN,
  at,
  priceMicroUsdc,
  resource: 'https://api.demo-in.dev/v1/gst-lookup'
});

describe('demo admin endpoints', () => {
  let handle: DbHandle;
  let app: ReturnType<typeof buildApp>;
  let seed: LedgerSeed;

  const post = (url: string, payload: object, headers = ADMIN) =>
    app.inject({ method: 'POST', url, headers, payload });

  beforeAll(async () => {
    handle = await testDb();
    seed = await seedParties(handle.db);
    await handle.db.insert(agentWallet).values([
      { agentID: seed.agents.resident, accountID: '0.0.6001' },
      { agentID: seed.agents.unknown, accountID: '0.0.6003' }
    ]);
    await handle.db.insert(receiverWallet).values({
      receiverID: seed.receivers.in,
      accountID: RECEIVER_IN,
      proofSignature: 'ff',
      verifiedAt: new Date()
    });
    const fx = demoFixedFx('88.40');
    if (!fx) throw new Error('fx');
    app = buildApp({
      logger: false,
      routes: [
        demoRoutes({ db: handle.db, pack: await loadTestPack(), fx, adminToken: ADMIN_TOKEN })
      ]
    });
  });

  afterAll(async () => {
    await handle.close();
  });

  describe('POST /v1/admin/sample-payments', () => {
    it('records samples oldest first, taxing the one that crosses the threshold', async () => {
      // ₹9,724 (110 USDC), then ₹884 (10 USDC) crosses ₹10,000: 1% of ₹884 is 0.1 USDC
      const response = await post('/v1/admin/sample-payments', {
        payments: [
          sample('crossing', '2026-08-02T10:00:00.000Z', '10000000'),
          sample('opening', '2026-08-01T10:00:00.000Z', '110000000')
        ]
      });
      expect(response.json()).toEqual({ inserted: 2, existing: 0 });

      const rows = await handle.db
        .select()
        .from(payment)
        .where(eq(payment.agentID, seed.agents.resident))
        .orderBy(asc(payment.createdAt));
      expect(rows.map((row) => [row.inrValuePaise, row.tdsMicro, row.sample])).toEqual([
        [972_400n, 0n, true],
        [88_400n, 100_000n, true]
      ]);
      expect(rows[1]?.status).toBe('settled');
      expect(rows[1]?.reserveAccountID).toBe('0.0.6101');

      const [total] = await handle.db
        .select()
        .from(aggregate)
        .where(eq(aggregate.agentID, seed.agents.resident));
      expect(total).toMatchObject({ fy: '2026-27', valuePaise: 1_060_800n, paymentsCount: 2 });
    });

    it('skips samples already recorded, so the seed can run again', async () => {
      const response = await post('/v1/admin/sample-payments', {
        payments: [sample('opening', '2026-08-01T10:00:00.000Z', '110000000')]
      });
      expect(response.json()).toEqual({ inserted: 0, existing: 1 });
    });

    it('writes nothing when a party is not registered', async () => {
      const response = await post('/v1/admin/sample-payments', {
        payments: [
          sample('fine', '2026-08-03T10:00:00.000Z', '100000', UNKNOWN),
          sample('stranger', '2026-08-03T10:00:00.000Z', '100000', 'hedera:testnet:0.0.9999')
        ]
      });
      expect(response.statusCode).toBe(400);
      const unknown = await handle.db
        .select()
        .from(payment)
        .where(eq(payment.agentID, seed.agents.unknown));
      expect(unknown).toHaveLength(0);
    });

    it('requires the admin token', async () => {
      const response = await post(
        '/v1/admin/sample-payments',
        { payments: [sample('x', '2026-08-03T10:00:00.000Z', '1')] },
        { authorization: 'Bearer wrong' }
      );
      expect(response.statusCode).toBe(401);
    });
  });
});
