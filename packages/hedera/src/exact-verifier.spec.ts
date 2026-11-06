import { type ExactTerms, verifyExactTransfer } from './exact-verifier';
import { signedVariant, VALID_START, type Variant } from './transfer-verifier.fixture';
import { accountIdSchema, tokenIdSchema } from '@kosha/shared/ids';
import { amountSchema } from '@kosha/shared/money';
import { describe, expect, it } from 'vitest';

// A stock x402 client paying the all-in total (0.101019 USDC) to Kosha's compat account 0.0.4200
const TERMS: ExactTerms = {
  asset: tokenIdSchema.parse('0.0.429274'),
  payTo: accountIdSchema.parse('0.0.4200'),
  amount: amountSchema.parse('101019'),
  feePayer: accountIdSchema.parse('0.0.4000'),
  maxTransactionFeeHbar: '2',
  window: {
    notBefore: new Date(VALID_START.getTime() - 60_000),
    notAfter: new Date(VALID_START.getTime() + 120_000)
  }
};
const STOCK: Variant = {
  memo: '',
  nodes: ['0.0.7'],
  legs: [
    ['0.0.6001', -101_019n],
    ['0.0.4200', 101_019n]
  ]
};

const codeOf = async (variant: Variant) => {
  const result = verifyExactTransfer(await signedVariant({ ...STOCK, ...variant }), TERMS);
  return result.ok ? 'ok' : result.data.code;
};

describe('verifyExactTransfer', () => {
  it('accepts a standard exact payment with any memo and nodes, and names the payer', async () => {
    const result = verifyExactTransfer(await signedVariant(STOCK), TERMS);
    expect(result.ok && result.data.payer).toBe('0.0.6001');
    expect(await codeOf({ memo: 'paid by a stock client', nodes: ['0.0.3', '0.0.4'] })).toBe('ok');
  });

  it('refuses another fee payer, a fee over the cap and a valid start outside the window', async () => {
    expect(await codeOf({ feePayer: '0.0.9185802' })).toBe('wrong_fee_payer');
    expect(await codeOf({ maxFeeHbar: '5' })).toBe('fee_too_high');
    expect(await codeOf({ validStart: new Date(VALID_START.getTime() + 600_000) })).toBe(
      'valid_start_out_of_window'
    );
  });

  it('refuses any credit but payTo, a short amount and another token', async () => {
    const tds: Variant = {
      legs: [
        ['0.0.6001', -101_019n],
        ['0.0.4200', 100_000n],
        ['0.0.6101', 1_019n]
      ]
    };
    expect(await codeOf(tds)).toBe('transfer_count');
    const short: Variant = {
      legs: [
        ['0.0.6001', -100_000n],
        ['0.0.4200', 100_000n]
      ]
    };
    expect(await codeOf(short)).toBe('amount_mismatch');
    expect(await codeOf({ token: '0.0.7000' })).toBe('wrong_token');
  });

  it('refuses two payers, HBAR movement and allowance transfers', async () => {
    const split: Variant = {
      legs: [
        ['0.0.6001', -50_000n],
        ['0.0.6002', -51_019n],
        ['0.0.4200', 101_019n]
      ]
    };
    expect(await codeOf(split)).toBe('multiple_debits');
    expect(await codeOf({ hbar: true })).toBe('hbar_movement');
    expect(await codeOf({ approvedDebit: true })).toBe('approved_transfer');
  });

  it('accepts a stock client that declares no decimals, but not one that declares others', async () => {
    expect(await codeOf({ decimals: null })).toBe('ok');
    expect(await codeOf({ decimals: 8 })).toBe('wrong_token');
  });

  it('refuses a payment from Core’s own account', async () => {
    const own: Variant = {
      legs: [
        ['0.0.4000', -101_019n],
        ['0.0.4200', 101_019n]
      ]
    };
    expect(await codeOf(own)).toBe('fee_payer_transferring');
  });
});
