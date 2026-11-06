import { savePolicy } from './agent-policy';
import type { DbHandle } from './db/client';
import { quote } from './db/schema';
import { testDb } from './db/test-db';
import { EXPIRES_AT, payloadFor, QUOTE_ID, seedQuotedPayment, verifyDeps } from './payment.fixture';
import { verifyPayment } from './payment-verify';
import { PrivateKey, Transaction } from '@hiero-ledger/sdk';
import { signedVariant } from '@kosha/hedera/transfer-verifier.fixture';
import { amountSchema } from '@kosha/shared/money';
import { exactRequirementsSchema, paymentRequirementsSchema } from '@kosha/shared/x402-payment';
import { exactEntry } from '@kosha/shared/x402-payment.fixture';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('verifyPayment', () => {
  let handle: DbHandle;
  let receiverId: string;
  let agentId: string;

  beforeEach(async () => {
    handle = await testDb();
    ({ receiverId, agentId } = await seedQuotedPayment(handle.db));
  });

  afterEach(async () => {
    await handle.close();
  });

  const verify = async (transaction: string, overrides = {}, asReceiver = receiverId) =>
    verifyPayment(verifyDeps(handle.db, overrides), asReceiver, payloadFor(transaction));
  const codeOf = (result: Awaited<ReturnType<typeof verifyPayment>>) =>
    result.ok ? 'ok' : result.data.code;

  it('accepts the quoted transfer signed by a declared wallet', async () => {
    const result = await verify(await signedVariant());
    expect(result.ok && result.data.payer).toBe('0.0.6001');
    expect(result.ok && result.data.quote.id).toBe(QUOTE_ID);
  });

  it('refuses an exact entry for an unknown quote, another receiver, and an expired quote', async () => {
    const exact = paymentRequirementsSchema.parse(exactEntry);
    const payload = { ...payloadFor(await signedVariant()), accepted: exact };
    const other = await verifyPayment(verifyDeps(handle.db), receiverId, payload);
    expect(other).toEqual({ ok: false, data: { code: 'quote_not_found', quoteId: 'q_7f3b' } });
    const bareEntry = exactRequirementsSchema.parse({
      ...exactEntry,
      extra: { feePayer: '0.0.4000' }
    });
    const bare = { ...payload, accepted: bareEntry };
    expect(await verifyPayment(verifyDeps(handle.db), receiverId, bare)).toEqual({
      ok: false,
      data: { code: 'quote_not_found', quoteId: null }
    });

    expect(codeOf(await verify(await signedVariant(), {}, 'another-receiver'))).toBe(
      'quote_not_found'
    );
    const late = { now: () => new Date(EXPIRES_AT.getTime() + 1_000) };
    expect(codeOf(await verify(await signedVariant(), late))).toBe('quote_expired');
  });

  it('refuses a used quote', async () => {
    await handle.db
      .update(quote)
      .set({ usedTransactionID: '0.0.4000@1762425000.000000000' })
      .where(eq(quote.id, QUOTE_ID));
    expect(codeOf(await verify(await signedVariant()))).toBe('replay');
  });

  it('refuses a transaction already spent on another quote', async () => {
    const signed = await signedVariant();
    const spentId = Transaction.fromBytes(Buffer.from(signed, 'base64')).transactionId?.toString();
    const [stored] = await handle.db.select().from(quote).where(eq(quote.id, QUOTE_ID));
    if (!stored) throw new Error('fixture quote missing');
    await handle.db.insert(quote).values({ ...stored, id: 'q_spent', usedTransactionID: spentId });
    expect(codeOf(await verify(signed))).toBe('replay');
  });

  it('passes the verifier code through', async () => {
    const legs: [string, bigint][] = [
      ['0.0.6001', -101_019n],
      ['0.0.5001', 101_019n]
    ];
    expect(codeOf(await verify(await signedVariant({ legs })))).toBe('transfer_count');
  });

  it('refuses a payer that is not a declared wallet of the quoted agent', async () => {
    const legs: [string, bigint][] = [
      ['0.0.6009', -101_019n],
      ['0.0.5001', 100_000n],
      ['0.0.6101', 1_019n]
    ];
    expect(codeOf(await verify(await signedVariant({ legs })))).toBe('payer_not_declared');
  });

  it('checks the signature with the Mirror Node key, and reports a Mirror outage', async () => {
    const forged = await signedVariant({ key: PrivateKey.generateED25519() });
    expect(codeOf(await verify(forged))).toBe('bad_signature');

    const down = {
      payerKey: async () => ({ ok: false as const, data: { reason: 'unavailable' as const } })
    };
    expect(codeOf(await verify(await signedVariant(), down))).toBe('core_unavailable');
  });

  it("re-checks the agent's policy, so a cap tightened after the quote holds", async () => {
    const rules = {
      perPaymentMicro: amountSchema.parse('500000'),
      dailyMicro: amountSchema.parse('5000000'),
      fyBudgetMicro: amountSchema.parse('200000000'),
      allowlist: ['api.demo-in.dev'],
      thresholdAction: 'warn' as const,
      acceptRulepacks: ['in-2026.2']
    };
    await savePolicy(handle.db, agentId, rules);
    expect(codeOf(await verify(await signedVariant()))).toBe('ok');

    // The quote is 100000 of price plus 1019 of TDS
    await savePolicy(handle.db, agentId, {
      ...rules,
      perPaymentMicro: amountSchema.parse('100000')
    });
    expect(codeOf(await verify(await signedVariant()))).toBe('policy_per_payment');

    await savePolicy(handle.db, agentId, { ...rules, thresholdAction: 'block' });
    expect(codeOf(await verify(await signedVariant()))).toBe('policy_threshold_block');
  });
});
