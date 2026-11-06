import { KoshaPayRefusal, koshaSplitScheme, signSplitPayment } from './kosha-split-scheme';
import { parsePayConfig, type PayConfig } from './pay-config';
import { PAY_CONFIG, PAYER_KEY } from './pay-config.fixture';
import { verifyPayerSignature, verifyTransfer } from '@kosha/hedera/transfer-verifier';
import { koshaSplitRequirementsSchema, paymentRequiredSchema } from '@kosha/shared/x402-payment';
import { exactEntry, paymentRequired, splitEntry } from '@kosha/shared/x402-payment.fixture';
import { x402Client } from '@x402/core/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Two minutes before the fixture quote expires
const NOW = new Date('2026-11-06T10:30:00Z');

const parsedConfig = parsePayConfig(PAY_CONFIG);
if (!parsedConfig.ok) {
  throw new Error('[kosha-split-scheme.spec]: fixture config failed to parse');
}
const CONFIG: PayConfig = parsedConfig.data;

type Kosha = (typeof splitEntry)['extra']['kosha'];
// The fixture's two legs: 0.10 USDC to the API and 1019 micro-USDC to the agent's reserve
const considerationLeg = { account: '0.0.5001', amount: '100000', leg: 'consideration' };
const reserveLeg = { account: '0.0.6101', amount: '1019', leg: 'tds_reserve' };
const quoteWith = (kosha: Partial<Kosha> = {}, top: Record<string, unknown> = {}) => ({
  ...splitEntry,
  ...top,
  extra: { ...splitEntry.extra, kosha: { ...splitEntry.extra.kosha, ...kosha } }
});

// What Core's verifier will check the signed bytes against
const verifyAsCore = (transaction: string, quote: unknown = splitEntry) => {
  const requirements = koshaSplitRequirementsSchema.parse(quote);
  const verified = verifyTransfer(transaction, {
    requirements,
    expectedReserveAccount: CONFIG.reserveAccountId,
    maxTransactionFeeHbar: CONFIG.maxTransactionFeeHbar,
    window: {
      notBefore: new Date(NOW.getTime() - 60_000),
      notAfter: new Date(requirements.extra.kosha.expiresAt)
    }
  });
  if (!verified.ok) {
    return verified;
  }
  return verifyPayerSignature(verified.data.transaction, PAYER_KEY.publicKey);
};

describe('signSplitPayment', () => {
  it('signs exactly the quoted transfer, which passes Core’s verifier', async () => {
    const signed = await signSplitPayment(splitEntry, CONFIG, NOW);

    if (!signed.ok) {
      throw new Error(signed.data.reason);
    }
    expect(verifyAsCore(signed.data.transaction)).toEqual({ ok: true });
  });

  it('signs a quote with no TDS leg', async () => {
    const quote = quoteWith({
      totalMicro: '100000',
      transfers: [considerationLeg],
      tax: {
        ...splitEntry.extra.kosha.tax,
        rateBps: 0,
        tdsMicroUsdc: '0',
        reason: 'under_threshold'
      }
    });

    const signed = await signSplitPayment(quote, CONFIG, NOW);

    expect(signed.ok && verifyAsCore(signed.data.transaction, quote)).toEqual({ ok: true });
  });

  it.each([
    ['the compatibility entry', exactEntry, 'not_kosha_split'],
    ['another network', quoteWith({}, { network: 'hedera:mainnet' }), 'wrong_network'],
    ['another token', quoteWith({}, { asset: '0.0.999' }), 'wrong_token'],
    [
      'an untrusted fee payer',
      { ...splitEntry, extra: { ...splitEntry.extra, feePayer: '0.0.9999' } },
      'untrusted_fee_payer'
    ],
    [
      'an amount that differs from the payTo leg',
      quoteWith({}, { amount: '90000' }),
      'consideration_mismatch'
    ],
    ['legs that do not sum to the total', quoteWith({ totalMicro: '200000' }), 'total_mismatch'],
    ['a memo for another quote', quoteWith({ memo: 'kosha:q_other' }), 'memo_mismatch'],
    [
      'a reserve leg that differs from the quoted TDS',
      quoteWith({
        transfers: [considerationLeg, { ...reserveLeg, amount: '5000' }],
        totalMicro: '105000'
      }),
      'tds_mismatch'
    ],
    [
      'a reserve leg to another account',
      quoteWith({ transfers: [considerationLeg, { ...reserveLeg, account: '0.0.7777' }] }),
      'reserve_not_ours'
    ],
    ['an expired quote', quoteWith({ expiresAt: '2026-11-06T10:29:59Z' }), 'quote_expired'],
    [
      'a quote that pays the payer',
      quoteWith(
        { transfers: [{ ...considerationLeg, account: '0.0.6001' }, reserveLeg] },
        { payTo: '0.0.6001' }
      ),
      'payer_is_recipient'
    ]
  ] as const)('refuses %s', async (_label, quote, reason) => {
    expect(await signSplitPayment(quote, CONFIG, NOW)).toEqual({ ok: false, data: { reason } });
  });
});

describe('koshaSplitScheme in @x402/core’s x402Client', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const clientWith = () =>
    new x402Client().register('hedera:testnet', koshaSplitScheme(CONFIG)).setSpendControls(false);

  it('picks the kosha-split entry from a 402 and signs it', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });

    const payload = await clientWith().createPaymentPayload(
      paymentRequiredSchema.parse(paymentRequired)
    );

    expect(payload.accepted).toEqual(splitEntry);
    expect(verifyAsCore(String(payload.payload.transaction))).toEqual({ ok: true });
  });

  it('surfaces a refusal as KoshaPayRefusal', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const tampered = paymentRequiredSchema.parse({
      ...paymentRequired,
      accepts: [
        quoteWith({ transfers: [considerationLeg, { ...reserveLeg, account: '0.0.7777' }] })
      ]
    });

    await expect(clientWith().createPaymentPayload(tampered)).rejects.toMatchObject({
      name: KoshaPayRefusal.name,
      reason: 'reserve_not_ours'
    });
  });
});
