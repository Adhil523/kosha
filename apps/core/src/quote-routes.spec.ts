import { readRulePack } from './active-rule-pack';
import { savePolicy } from './agent-policy';
import { buildApp } from './app';
import { hashApiKey } from './auth';
import type { DbHandle } from './db/client';
import { agent, aggregate, quote, receiver, receiverWallet } from './db/schema';
import { testDb } from './db/test-db';
import { demoFixedFx } from './fx';
import { quoteRoutes } from './quote-routes';
import { createPayerResolver } from './resolve-payer';
import { findRepoRoot } from '@kosha/shared/env';
import { amountSchema } from '@kosha/shared/money';
import type { Policy } from '@kosha/shared/registry';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const NOW = new Date('2026-11-06T10:30:00Z');
const FY = '2026-27';
const PRICE = {
  priceMicroUsdc: '100000',
  method: 'GET',
  resource: { url: 'https://api.demo-in.dev/v1/gst-lookup' }
};
type Receiver = 'business' | 'solo' | 'strict' | 'foreign';

describe('POST /v1/quote', () => {
  let handle: DbHandle;
  let app: ReturnType<typeof buildApp>;
  const receiverIds: Partial<Record<Receiver, string>> = {};
  const agentIds: Record<string, string> = {};

  const quoteFor = (as: Receiver, agentIdentity?: string) =>
    app.inject({
      method: 'POST',
      url: '/v1/quote',
      headers: { authorization: `Bearer key-${as}-${'k'.repeat(32)}` },
      payload: { ...PRICE, ...(agentIdentity ? { agent: agentIdentity } : {}) }
    });

  const seedTotal = (agentIdentity: string, as: Receiver, valuePaise: bigint) =>
    handle.db.insert(aggregate).values({
      agentID: agentIds[agentIdentity] ?? '',
      receiverID: receiverIds[as] ?? '',
      fy: FY,
      valuePaise
    });

  const splitOf = (response: { json: () => unknown }) => {
    const body = response.json() as { accepts: [{ extra: { kosha: Record<string, unknown> } }] };
    return body.accepts[0].extra.kosha as {
      tax: { rateBps: number; reason: string; tdsMicroUsdc: string; flags: string[] };
      transfers: { account: string; amount: string; leg: string }[];
      totalMicro: string;
      register?: string;
    };
  };

  beforeEach(async () => {
    handle = await testDb();
    const rows: [Receiver, Record<string, unknown>][] = [
      [
        'business',
        { residency: 'resident', specifiedPerson: false, unverifiedPolicy: 'threshold_tolerant' }
      ],
      [
        'solo',
        { residency: 'resident', specifiedPerson: true, unverifiedPolicy: 'threshold_tolerant' }
      ],
      ['strict', { residency: 'resident', specifiedPerson: false, unverifiedPolicy: 'strict' }],
      [
        'foreign',
        {
          residency: 'non_resident',
          specifiedPerson: false,
          unverifiedPolicy: 'threshold_tolerant'
        }
      ]
    ];
    for (const [index, [name, fields]] of rows.entries()) {
      const [row] = await handle.db
        .insert(receiver)
        .values({
          legalName: name,
          mode: 'threshold',
          apiKeyHash: hashApiKey(`key-${name}-${'k'.repeat(32)}`),
          ...(fields as {
            residency: 'resident';
            specifiedPerson: boolean;
            unverifiedPolicy: 'strict';
          })
        })
        .returning();
      receiverIds[name] = row?.id;
      await handle.db.insert(receiverWallet).values({
        receiverID: row?.id ?? '',
        accountID: `0.0.500${index + 1}`,
        proofSignature: 'ff',
        verifiedAt: NOW
      });
    }
    for (const [identity, fields] of [
      [
        'hedera:testnet:0.0.6001',
        { level: 1, residency: 'resident', panOnFile: true, reserveAccountID: '0.0.6101' }
      ],
      [
        'hedera:testnet:0.0.6002',
        { level: 1, residency: 'non_resident', reserveAccountID: '0.0.6102' }
      ]
    ] as const) {
      const [row] = await handle.db
        .insert(agent)
        .values({ identity, ...fields })
        .returning();
      agentIds[identity] = row?.id ?? '';
    }

    const rulePack = await readRulePack(
      'rulepacks/in-2026.2.json',
      findRepoRoot(process.cwd()) ?? ''
    );
    if (!rulePack.ok) throw new Error(rulePack.data.reason);
    const fx = demoFixedFx('88.40');
    if (!fx) throw new Error('fx');
    let reserves = 0;
    app = buildApp({
      logger: false,
      routes: [
        quoteRoutes({
          db: handle.db,
          rulePack: rulePack.data,
          fx,
          resolvePayer: createPayerResolver(handle.db, async () => `0.0.610${3 + reserves++}`),
          network: 'testnet',
          feePayer: '0.0.4000',
          settlementTokenId: '0.0.429274',
          compatSettlementAccountId: '0.0.4200',
          poolReserveAccountId: '0.0.4300',
          nodeAccountIds: ['0.0.3', '0.0.4', '0.0.5'],
          registerUrl: 'https://console.kosha.dev/register?level=1',
          now: () => NOW
        })
      ]
    });
  });

  afterEach(async () => {
    await handle.close();
  });

  it('quotes price only under the threshold', async () => {
    const response = await quoteFor('business', 'hedera:testnet:0.0.6001');
    expect(response.statusCode).toBe(200);
    const split = splitOf(response);
    expect(split.tax).toMatchObject({ rateBps: 0, reason: 'under_threshold', tdsMicroUsdc: '0' });
    expect(split.transfers).toEqual([
      { account: '0.0.5001', amount: '100000', leg: 'consideration' }
    ]);
  });

  it('withholds 1% on the whole crossing payment, into the agent’s own reserve', async () => {
    // ₹9,995 + ₹8.84 crosses ₹10,000
    await seedTotal('hedera:testnet:0.0.6001', 'business', 999_500n);
    const split = splitOf(await quoteFor('business', 'hedera:testnet:0.0.6001'));
    expect(split.tax).toMatchObject({
      rateBps: 100,
      reason: 'threshold_crossed',
      tdsMicroUsdc: '1019'
    });
    expect(split.transfers).toEqual([
      { account: '0.0.5001', amount: '100000', leg: 'consideration' },
      { account: '0.0.6101', amount: '1019', leg: 'tds_reserve' }
    ]);
    expect(split.totalMicro).toBe('101019');
  });

  it('uses ₹50,000 for a specified-person receiver', async () => {
    // ₹9,995 + ₹8.84 would cross ₹10,000 but not a specified person's ₹50,000
    await seedTotal('hedera:testnet:0.0.6001', 'solo', 999_500n);
    expect(splitOf(await quoteFor('solo', 'hedera:testnet:0.0.6001')).tax.reason).toBe(
      'under_threshold'
    );
  });

  it('charges a Level 0 payer 20% from the first rupee under a strict receiver, and links to Level 1', async () => {
    const split = splitOf(await quoteFor('strict', 'hedera:testnet:0.0.6003'));
    expect(split.tax).toMatchObject({
      rateBps: 2000,
      reason: 'first_rupee',
      tdsMicroUsdc: '20023'
    });
    expect(split.transfers[1]).toEqual({
      account: '0.0.6103',
      amount: '20023',
      leg: 'tds_reserve'
    });
    expect(split.register).toBe('https://console.kosha.dev/register?level=1');
  });

  it('lets a Level 0 payer pay tax-free within the tolerance, then 20% beyond it', async () => {
    expect(splitOf(await quoteFor('business', 'hedera:testnet:0.0.6003')).tax.reason).toBe(
      'within_tolerance'
    );
    const unknownId = (await handle.db.select().from(agent)).find((row) =>
      row.identity.endsWith('0.0.6003')
    )?.id;
    agentIds['hedera:testnet:0.0.6003'] = unknownId ?? '';
    await seedTotal('hedera:testnet:0.0.6003', 'business', 499_500n);
    const split = splitOf(await quoteFor('business', 'hedera:testnet:0.0.6003'));
    expect(split.tax).toMatchObject({ rateBps: 2000, reason: 'tolerance_exceeded' });
  });

  it('flags a non-resident payer and a foreign receiver, withholding nothing', async () => {
    const payer = splitOf(await quoteFor('business', 'hedera:testnet:0.0.6002')).tax;
    expect(payer).toMatchObject({
      reason: 'non_resident',
      flags: ['fema_review'],
      tdsMicroUsdc: '0'
    });
    const foreign = splitOf(await quoteFor('foreign', 'hedera:testnet:0.0.6001')).tax;
    expect(foreign).toMatchObject({ reason: 'receiver_non_resident', flags: ['fema_review'] });
  });

  it('counts an open quote, so of two concurrent quotes near the threshold the second withholds', async () => {
    await seedTotal('hedera:testnet:0.0.6001', 'business', 998_500n);
    const responses = await Promise.all([
      quoteFor('business', 'hedera:testnet:0.0.6001'),
      quoteFor('business', 'hedera:testnet:0.0.6001')
    ]);
    const reasons = responses.map((response) => splitOf(response).tax.reason).sort();
    expect(reasons).toEqual(['threshold_crossed', 'under_threshold']);
  });

  it('refuses a request without a receiver key', async () => {
    const noKey = await app.inject({ method: 'POST', url: '/v1/quote', payload: PRICE });
    expect(noKey.statusCode).toBe(401);
  });

  describe('compatibility mode', () => {
    type Entry = { scheme: string; payTo: string; amount: string; extra: { kosha: object } };
    const entriesOf = (response: { json: () => unknown }) =>
      (response.json() as { accepts: Entry[] }).accepts;

    it('adds an exact entry paying the all-in total to the settlement account', async () => {
      await seedTotal('hedera:testnet:0.0.6001', 'business', 999_500n);
      const [split, exact] = entriesOf(await quoteFor('business', 'hedera:testnet:0.0.6001'));
      const quoteId = (split?.extra.kosha as { quoteId: string }).quoteId;
      expect(exact).toMatchObject({
        scheme: 'exact',
        payTo: '0.0.4200',
        amount: '101019',
        extra: { feePayer: '0.0.4000', kosha: { quoteId, mode: 'compat' } }
      });
    });

    it('prices a caller with no agent as an unverified payer whose tolerance is used up', async () => {
      // 20% of ₹8.84 is 177 paise: 20023 micro-USDC on top of the 0.10 USDC price
      const accepts = entriesOf(await quoteFor('business'));
      expect(accepts).toHaveLength(1);
      expect(accepts[0]).toMatchObject({ scheme: 'exact', payTo: '0.0.4200', amount: '120023' });

      const [row] = await handle.db.select().from(quote);
      expect(row).toMatchObject({
        scheme: 'exact_compat',
        agentID: null,
        reason: 'tolerance_exceeded',
        rateBps: 2000,
        tdsMicro: 20_023n,
        payToAccountID: '0.0.5001',
        reserveAccountID: '0.0.4300'
      });
    });

    it('charges a strict receiver’s unidentified caller 20% and a foreign one nothing', async () => {
      expect(entriesOf(await quoteFor('strict'))[0]?.amount).toBe('120023');
      expect(entriesOf(await quoteFor('foreign'))[0]?.amount).toBe('100000');
    });
  });

  describe('with a spending policy', () => {
    const RESIDENT = 'hedera:testnet:0.0.6001';
    const RULES: Policy = {
      perPaymentMicro: amountSchema.parse('500000'),
      dailyMicro: amountSchema.parse('5000000'),
      fyBudgetMicro: amountSchema.parse('200000000'),
      allowlist: ['api.demo-in.dev'],
      thresholdAction: 'warn',
      acceptRulepacks: ['in-2026.2']
    };

    const withPolicy = (overrides: Partial<Policy>) =>
      savePolicy(handle.db, agentIds[RESIDENT] ?? '', { ...RULES, ...overrides });

    const refusal = async () => {
      const response = await quoteFor('business', RESIDENT);
      return { status: response.statusCode, error: (response.json() as { error?: string }).error };
    };

    it('quotes inside every rule', async () => {
      await withPolicy({});
      expect((await quoteFor('business', RESIDENT)).statusCode).toBe(200);
    });

    it('refuses a resource whose host is off the allowlist, and stores no quote', async () => {
      await withPolicy({ allowlist: ['api.demo-global.dev'] });
      expect(await refusal()).toEqual({ status: 403, error: 'policy_allowlist' });
      expect(await handle.db.select().from(quote)).toHaveLength(0);
    });

    it('counts the tax: TDS pushes a price at the per-payment cap over it', async () => {
      await withPolicy({ perPaymentMicro: amountSchema.parse('100000') });
      expect((await quoteFor('business', RESIDENT)).statusCode).toBe(200);
      // Crossing the threshold adds 1019 micro-USDC of TDS to the 100000 price
      await seedTotal(RESIDENT, 'business', 999_500n);
      expect(await refusal()).toEqual({ status: 403, error: 'policy_per_payment' });
    });

    it("refuses a quote that would pass today's cap, counting open quotes", async () => {
      await withPolicy({ dailyMicro: amountSchema.parse('250000') });
      expect((await quoteFor('business', RESIDENT)).statusCode).toBe(200);
      expect((await quoteFor('business', RESIDENT)).statusCode).toBe(200);
      expect(await refusal()).toEqual({ status: 403, error: 'policy_daily' });
    });

    it("refuses a quote that would pass the year's budget", async () => {
      await withPolicy({ fyBudgetMicro: amountSchema.parse('150000') });
      expect((await quoteFor('business', RESIDENT)).statusCode).toBe(200);
      expect(await refusal()).toEqual({ status: 403, error: 'policy_budget' });
    });

    it('blocks a quote that withholds TDS when the threshold action is block', async () => {
      await withPolicy({ thresholdAction: 'block' });
      expect((await quoteFor('business', RESIDENT)).statusCode).toBe(200);
      await seedTotal(RESIDENT, 'business', 999_500n);
      expect(await refusal()).toEqual({ status: 403, error: 'policy_threshold_block' });
    });

    it('quotes a withholding payment when the threshold action is warn', async () => {
      await withPolicy({ thresholdAction: 'warn' });
      await seedTotal(RESIDENT, 'business', 999_500n);
      expect((await quoteFor('business', RESIDENT)).statusCode).toBe(200);
    });
  });
});
