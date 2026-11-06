import { buildQuotedTransfer } from './quoted-transfer';
import { Hbar, PrivateKey, Transaction, TransferTransaction } from '@hiero-ledger/sdk';
import { accountIdSchema } from '@kosha/shared/ids';
import { type KoshaSplitRequirements, paymentRequiredSchema } from '@kosha/shared/x402-payment';
import { paymentRequired, splitEntry } from '@kosha/shared/x402-payment.fixture';
import { describe, expect, it } from 'vitest';

const PAYER = accountIdSchema.parse('0.0.6001');
const VALID_START = new Date('2026-11-06T10:30:00Z');
const OPTIONS = { maxTransactionFeeHbar: '2', validStart: VALID_START };

const requirementsFrom = (entry: unknown): KoshaSplitRequirements => {
  const [first] = paymentRequiredSchema.parse({ ...paymentRequired, accepts: [entry] }).accepts;
  if (first?.scheme !== 'kosha-split') throw new Error('expected a kosha-split entry');
  return first;
};

const buildSigned = async (key: PrivateKey) => {
  const built = buildQuotedTransfer(requirementsFrom(splitEntry), PAYER, OPTIONS);
  if (!built.ok) throw new Error(built.data.reason);
  const signed = await built.data.sign(key);
  return Transaction.fromBytes(signed.toBytes());
};

describe('buildQuotedTransfer', () => {
  it('survives a bytes round trip with every quoted field intact', async () => {
    const parsed = await buildSigned(PrivateKey.generateED25519());

    expect(parsed).toBeInstanceOf(TransferTransaction);
    if (!(parsed instanceof TransferTransaction)) return;
    expect(parsed.transactionId?.accountId?.toString()).toBe('0.0.4000');
    expect(parsed.transactionId?.validStart?.toDate()).toEqual(VALID_START);
    expect(parsed.nodeAccountIds?.map((node) => node.toString())).toEqual([
      '0.0.3',
      '0.0.4',
      '0.0.5'
    ]);
    expect(parsed.transactionMemo).toBe('kosha:q_7f3a');
    expect(parsed.maxTransactionFee?.toTinybars().toString()).toBe(
      new Hbar(2).toTinybars().toString()
    );
    expect(parsed.hbarTransfers.size).toBe(0);

    const legs = parsed.tokenTransfers.get('0.0.429274');
    const amounts = Object.fromEntries(
      [...(legs ?? [])].map(([account, amount]) => [account.toString(), amount.toString()])
    );
    expect(amounts).toEqual({ '0.0.6001': '-101019', '0.0.5001': '100000', '0.0.6101': '1019' });
  });

  it('carries the payer signature on the body for every node', async () => {
    const key = PrivateKey.generateECDSA();
    const parsed = await buildSigned(key);

    expect(key.publicKey.verifyTransaction(parsed)).toBe(true);
    expect(PrivateKey.generateECDSA().publicKey.verifyTransaction(parsed)).toBe(false);
    const signatures = parsed.getSignatures();
    expect([...signatures.keys()].map((node) => node.toString())).toEqual([
      '0.0.3',
      '0.0.4',
      '0.0.5'
    ]);
  });

  it('refuses a quote that breaks the split invariants', () => {
    const tampered = {
      ...splitEntry,
      extra: { ...splitEntry.extra, kosha: { ...splitEntry.extra.kosha, memo: 'kosha:q_other' } }
    };
    expect(buildQuotedTransfer(requirementsFrom(tampered), PAYER, OPTIONS)).toEqual({
      ok: false,
      data: { reason: 'memo_mismatch' }
    });
  });

  it('refuses to make the payer one of the recipients', () => {
    const payee = accountIdSchema.parse('0.0.5001');
    expect(buildQuotedTransfer(requirementsFrom(splitEntry), payee, OPTIONS)).toEqual({
      ok: false,
      data: { reason: 'payer_is_recipient' }
    });
  });

  it.each(['0', '-1', 'two', '1.123456789'])('refuses the fee cap %j', (cap) => {
    const built = buildQuotedTransfer(requirementsFrom(splitEntry), PAYER, {
      ...OPTIONS,
      maxTransactionFeeHbar: cap
    });
    expect(built).toEqual({ ok: false, data: { reason: 'invalid_fee_cap' } });
  });
});
