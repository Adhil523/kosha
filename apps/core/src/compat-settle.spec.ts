import type { DbHandle } from './db/client';
import { agent, agentWallet, aggregate, hcsOutbox, payment, quote } from './db/schema';
import { testDb } from './db/test-db';
import { payloadFor, QUOTE_ID, seedQuotedPayment, verifyDeps } from './payment.fixture';
import { type SettleDeps, settlePayment } from './payment-settle';
import type { Executed } from '@kosha/hedera/executor';
import { QUOTE, signedVariant, type Variant } from '@kosha/hedera/transfer-verifier.fixture';
import type { PaymentPayload } from '@kosha/shared/x402-payment';
import { exactRequirementsSchema, koshaSplitRequirementsSchema } from '@kosha/shared/x402-payment';
import { exactEntry } from '@kosha/shared/x402-payment.fixture';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SETTLED: Executed = {
  ok: true,
  data: { topicSequenceNumber: null, accountId: null, scheduleId: null }
};
const UNIDENTIFIED_QUOTE = 'q_compatunknown';

// How a stock @x402 client signs: any memo and nodes, payer → Kosha's settlement account
const stockPayment = (payer: string, total: bigint): Variant => ({
  memo: '',
  nodes: ['0.0.7'],
  legs: [
    [payer, -total],
    ['0.0.4200', total]
  ]
});

describe('settling a compatibility (exact) payment', () => {
  let handle: DbHandle;
  let receiverId: string;
  let agentId: string;

  const deps = (): SettleDeps => ({
    ...verifyDeps(handle.db),
    ledger: {
      pairSecret: 'pair-secret',
      rulepackHash: 'cd'.repeat(32),
      paymentsTopicId: '0.0.7100'
    },
    execute: async () => SETTLED,
    reconcile: async () => 'unknown'
  });
  const exactPayload = async (quoteId: string, variant: Variant): Promise<PaymentPayload> => ({
    ...payloadFor(await signedVariant(variant)),
    accepted: exactRequirementsSchema.parse({
      ...exactEntry,
      amount: String(-(variant.legs?.[0]?.[1] ?? 0n)),
      extra: { feePayer: '0.0.4000', kosha: { quoteId, mode: 'compat' } }
    })
  });

  beforeEach(async () => {
    handle = await testDb();
    ({ receiverId, agentId } = await seedQuotedPayment(handle.db));
    // A quote for a caller that sent no X-KOSHA-AGENT: 20% on ₹8.84
    const [split] = await handle.db.select().from(quote).where(eq(quote.id, QUOTE_ID));
    if (!split) throw new Error('fixture quote');
    await handle.db.insert(quote).values({
      ...split,
      id: UNIDENTIFIED_QUOTE,
      scheme: 'exact_compat',
      agentID: null,
      reserveAccountID: '0.0.4300',
      tdsMicro: 20_023n,
      totalMicro: 120_023n,
      rateBps: 2000,
      reason: 'tolerance_exceeded'
    });
  });

  afterEach(async () => {
    await handle.close();
  });

  it("books an identified agent's exact payment to it, with the TDS pooled", async () => {
    const payload = await exactPayload(QUOTE_ID, stockPayment('0.0.6001', 101_019n));
    const result = await settlePayment(deps(), receiverId, payload);
    expect(result.ok).toBe(true);

    const [paid] = await handle.db.select().from(payment);
    expect(paid).toMatchObject({
      agentID: agentId,
      reserveAccountID: '0.0.4300',
      tdsMicro: 1_019n
    });
    const [row] = await handle.db.select().from(quote).where(eq(quote.id, QUOTE_ID));
    expect(row?.scheme).toBe('exact_compat');
    const [message] = await handle.db.select().from(hcsOutbox);
    expect(message?.payload).toMatchObject({ t: 'pay', mode: 'compat' });
  });

  it('registers an unknown payer at Level 0 and books the pair to it', async () => {
    const payload = await exactPayload(UNIDENTIFIED_QUOTE, stockPayment('0.0.6009', 120_023n));
    const result = await settlePayment(deps(), receiverId, payload);
    expect(result.ok && result.data.payer).toBe('0.0.6009');

    const [wallet] = await handle.db
      .select()
      .from(agentWallet)
      .where(eq(agentWallet.accountID, '0.0.6009'));
    const [payer] = await handle.db
      .select()
      .from(agent)
      .where(eq(agent.id, wallet?.agentID ?? ''));
    expect(payer).toMatchObject({
      identity: 'hedera:testnet:0.0.6009',
      level: 0,
      reserveAccountID: null
    });
    const [total] = await handle.db
      .select()
      .from(aggregate)
      .where(eq(aggregate.agentID, payer?.id ?? ''));
    expect(total).toMatchObject({ receiverID: receiverId, valuePaise: 884n });
  });

  it('books an unidentified quote to the agent that declared the paying account', async () => {
    const payload = await exactPayload(UNIDENTIFIED_QUOTE, stockPayment('0.0.6001', 120_023n));
    await settlePayment(deps(), receiverId, payload);
    const [paid] = await handle.db.select().from(payment);
    expect(paid?.agentID).toBe(agentId);
  });

  it("refuses a payer outside the quoted agent's wallets, and kosha-split on a compat quote", async () => {
    const stranger = await exactPayload(QUOTE_ID, stockPayment('0.0.6009', 101_019n));
    const refused = await settlePayment(deps(), receiverId, stranger);
    expect(!refused.ok && refused.data.code).toBe('payer_not_declared');

    const onCompatQuote = koshaSplitRequirementsSchema.parse({
      ...QUOTE,
      extra: { ...QUOTE.extra, kosha: { ...QUOTE.extra.kosha, quoteId: UNIDENTIFIED_QUOTE } }
    });
    const wrongScheme = { ...payloadFor(await signedVariant()), accepted: onCompatQuote };
    const result = await settlePayment(deps(), receiverId, wrongScheme);
    expect(!result.ok && result.data.code).toBe('unsupported_scheme');
  });
});
