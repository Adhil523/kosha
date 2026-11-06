import { buildApp } from './app';
import type { DbHandle } from './db/client';
import { aggregate } from './db/schema';
import { testDb } from './db/test-db';
import {
  ADMIN,
  ADMIN_TOKEN,
  FY,
  type LedgerSeed,
  loadTestPack,
  NOW,
  receiverAuth,
  seedParties
} from './ledger.fixture';
import { ledgerRoutes } from './ledger-routes';
import { pairLimits } from './pair-limits';
import type { AggregateRow } from '@kosha/shared/console-api';
import type { RulePack } from '@kosha/tax-engine/rule-pack';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('GET /v1/aggregates', () => {
  let handle: DbHandle;
  let app: ReturnType<typeof buildApp>;
  let seed: LedgerSeed;
  let pack: RulePack;

  const aggregates = async (query: string, headers: Record<string, string> = ADMIN) => {
    const response = await app.inject({ method: 'GET', url: `/v1/aggregates?${query}`, headers });
    return { status: response.statusCode, rows: response.json() as AggregateRow[] };
  };

  beforeAll(async () => {
    handle = await testDb();
    seed = await seedParties(handle.db);
    pack = await loadTestPack();
    const { receivers, agents } = seed;
    await handle.db.insert(aggregate).values([
      // ₹9,500 of ₹10,000
      { agentID: agents.resident, receiverID: receivers.in, fy: FY, valuePaise: 950_000n },
      // ₹2,000 plus ₹500 seen outside Kosha, of an unverified payer's ₹5,000 tolerance
      {
        agentID: agents.unknown,
        receiverID: receivers.in,
        fy: FY,
        valuePaise: 200_000n,
        outsideValuePaise: 50_000n
      },
      // ₹10,000 of a specified person's ₹50,000
      { agentID: agents.resident, receiverID: receivers.solo, fy: FY, valuePaise: 1_000_000n },
      { agentID: agents.resident, receiverID: receivers.in, fy: '2025-26', valuePaise: 7n }
    ]);
    app = buildApp({
      logger: false,
      routes: [
        ledgerRoutes({
          db: handle.db,
          adminToken: ADMIN_TOKEN,
          network: 'testnet',
          pack,
          now: () => NOW
        })
      ]
    });
  });

  afterAll(async () => {
    await handle.close();
  });

  it("gives each of a receiver's pairs its threshold, tolerance and progress this year", async () => {
    const { status, rows } = await aggregates(`receiverId=${seed.receivers.in}`);
    expect(status).toBe(200);
    expect(rows).toEqual([
      {
        receiverId: seed.receivers.in,
        agentId: seed.agents.resident,
        agentLevel: 1,
        payerResidency: 'resident',
        fy: FY,
        valuePaise: '950000',
        outsideValuePaise: '0',
        thresholdPaise: '1000000',
        tolerancePaise: null,
        pct: 95
      },
      {
        receiverId: seed.receivers.in,
        agentId: seed.agents.unknown,
        agentLevel: 0,
        payerResidency: 'unknown',
        fy: FY,
        valuePaise: '200000',
        outsideValuePaise: '50000',
        thresholdPaise: '1000000',
        tolerancePaise: '500000',
        pct: 50
      }
    ]);
  });

  it("uses a specified person's ₹50,000 threshold", async () => {
    const { rows } = await aggregates('', receiverAuth('solo'));
    expect(rows).toMatchObject([{ thresholdPaise: '5000000', pct: 20 }]);
  });

  it('reads an earlier financial year on request', async () => {
    const { rows } = await aggregates(`receiverId=${seed.receivers.in}&fy=2025-26`);
    expect(rows.map((row) => row.valuePaise)).toEqual(['7']);
  });

  it("refuses a receiver key asking for another receiver's pairs", async () => {
    expect((await aggregates(`receiverId=${seed.receivers.in}`, receiverAuth('solo'))).status).toBe(
      403
    );
    expect((await aggregates('', {})).status).toBe(401);
  });

  it('gives an unverified payer no tolerance under a strict receiver', () => {
    const strict = { specifiedPerson: false, unverifiedPolicy: 'strict' as const };
    expect(pairLimits(pack, strict, 'unknown')).toEqual({
      thresholdPaise: 1_000_000n,
      tolerancePaise: null
    });
  });
});
