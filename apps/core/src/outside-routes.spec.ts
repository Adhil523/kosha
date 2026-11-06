import { buildApp } from './app';
import type { DbHandle } from './db/client';
import { aggregate, hcsOutbox, outsidePayment } from './db/schema';
import { testDb } from './db/test-db';
import {
  ADMIN,
  ADMIN_TOKEN,
  FY,
  type LedgerSeed,
  NOW,
  receiverAuth,
  seedParties
} from './ledger.fixture';
import { outsideRoutes } from './outside-routes';
import type { OutsidePaymentRow } from '@kosha/shared/console-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('outside payments: list and classify', () => {
  let handle: DbHandle;
  let app: ReturnType<typeof buildApp>;
  let seed: LedgerSeed;
  let flaggedId = '';

  const classify = (id: string, payload: object, headers: Record<string, string> = ADMIN) =>
    app.inject({ method: 'POST', url: `/v1/outside-payments/${id}/classify`, headers, payload });
  const outsideValue = async () => (await handle.db.select().from(aggregate))[0]?.outsideValuePaise;

  beforeEach(async () => {
    handle = await testDb();
    seed = await seedParties(handle.db);
    // What the watcher leaves behind: a ₹88.40 direct payment counted as outside value
    const [row] = await handle.db
      .insert(outsidePayment)
      .values({
        receiverID: seed.receivers.in,
        agentID: seed.agents.resident,
        fromWallet: '0.0.6001',
        toWallet: '0.0.5001',
        transactionID: '0.0.6001@1793960400.000000001',
        consensusAt: NOW,
        amountMicro: 1_000_000n,
        valuePaise: 8_840n,
        shortfallPaise: 0n,
        fy: FY
      })
      .returning();
    flaggedId = row?.id ?? '';
    await handle.db.insert(aggregate).values({
      agentID: seed.agents.resident,
      receiverID: seed.receivers.in,
      fy: FY,
      outsideValuePaise: 8_840n
    });
    app = buildApp({
      logger: false,
      routes: [
        outsideRoutes({
          db: handle.db,
          adminToken: ADMIN_TOKEN,
          pairSecret: 'pair-secret',
          paymentsTopicId: '0.0.7100'
        })
      ]
    });
  });

  afterEach(async () => {
    await handle.close();
  });

  it("lists a receiver's flagged payments, to the admin and to that receiver only", async () => {
    const own = await app.inject({
      method: 'GET',
      url: '/v1/outside-payments',
      headers: receiverAuth('in')
    });
    expect(own.json<OutsidePaymentRow[]>()).toMatchObject([
      { id: flaggedId, fromWallet: '0.0.6001', valuePaise: '8840', classification: 'pending' }
    ]);
    const other = await app.inject({
      method: 'GET',
      url: '/v1/outside-payments',
      headers: receiverAuth('solo')
    });
    expect(other.json()).toEqual([]);
  });

  it('takes a gift out of the threshold count and logs the classification', async () => {
    const response = await classify(flaggedId, {
      classification: 'not_consideration_gift',
      note: 'Diwali gift from the founder'
    });
    expect(response.json()).toMatchObject({
      classification: 'not_consideration_gift',
      note: 'Diwali gift from the founder'
    });
    expect(await outsideValue()).toBe(0n);
    const [message] = await handle.db.select().from(hcsOutbox);
    expect(message?.payload).toMatchObject({
      t: 'outside_resolved',
      oid: flaggedId,
      cls: 'not_consideration_gift'
    });
  });

  it('keeps consideration in the count, and classifies only once', async () => {
    expect((await classify(flaggedId, { classification: 'consideration' })).statusCode).toBe(200);
    expect(await outsideValue()).toBe(8_840n);
    expect((await classify(flaggedId, { classification: 'consideration' })).statusCode).toBe(409);
  });

  it("needs a note for a gift, and hides another receiver's payments", async () => {
    expect(
      (await classify(flaggedId, { classification: 'not_consideration_gift' })).statusCode
    ).toBe(400);
    const asOther = await classify(
      flaggedId,
      { classification: 'consideration' },
      receiverAuth('solo')
    );
    expect(asOther.statusCode).toBe(404);
    expect((await classify('missing', { classification: 'consideration' })).statusCode).toBe(404);
  });
});
