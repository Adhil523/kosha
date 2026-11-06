import { type PayConfig } from './pay-config';
import { buildQuotedTransfer, type QuotedTransferProblem } from '@kosha/hedera/quoted-transfer';
import { SCHEMES, X402_VERSION } from '@kosha/shared/headers';
import { checkSplitQuote } from '@kosha/shared/split-quote';
import { koshaSplitRequirementsSchema } from '@kosha/shared/x402-payment';
import { type PaymentPayloadResult, type SchemeNetworkClient } from '@x402/core/types';

export type SplitRefusal =
  | QuotedTransferProblem
  | 'not_kosha_split'
  | 'wrong_network'
  | 'wrong_token'
  | 'untrusted_fee_payer'
  | 'reserve_not_ours'
  | 'quote_expired';

export type SignSplitResult =
  { ok: true; data: { transaction: string } } | { ok: false; data: { reason: SplitRefusal } };

// Thrown through @x402/core, whose scheme interface has no result type; carries the refusal code
export class KoshaPayRefusal extends Error {
  readonly reason: SplitRefusal;

  constructor(reason: SplitRefusal) {
    super(`[kosha-pay]: refused to sign: ${reason}`);
    this.name = 'KoshaPayRefusal';
    this.reason = reason;
  }
}

const refuse = (reason: SplitRefusal): SignSplitResult => ({ ok: false, data: { reason } });

type SigningConfig = Pick<
  PayConfig,
  | 'network'
  | 'accountId'
  | 'privateKey'
  | 'reserveAccountId'
  | 'asset'
  | 'trustedFacilitators'
  | 'maxTransactionFeeHbar'
>;

// Checks a kosha-split entry against what this agent will pay, then builds and signs exactly the
// quoted transfer. Pay never signs anything the quote and these checks don't describe.
export const signSplitPayment = async (
  requirements: unknown,
  config: SigningConfig,
  now: Date = new Date()
): Promise<SignSplitResult> => {
  const parsed = koshaSplitRequirementsSchema.safeParse(requirements);
  if (!parsed.success) {
    return refuse('not_kosha_split');
  }
  const quote = parsed.data;
  if (quote.network !== `hedera:${config.network}`) {
    return refuse('wrong_network');
  }
  if (quote.asset !== config.asset) {
    return refuse('wrong_token');
  }
  if (!config.trustedFacilitators.includes(quote.extra.feePayer)) {
    return refuse('untrusted_fee_payer');
  }
  // The amount is the consideration to payTo, the legs sum to the total, the memo names the quote
  const split = checkSplitQuote(quote);
  if (!split.ok) {
    return refuse(split.data.reason);
  }
  // Mode C: the TDS must land in this agent's own reserve, never anyone else's account
  const { reserveAccount } = split.data;
  if (reserveAccount !== null && reserveAccount !== config.reserveAccountId) {
    return refuse('reserve_not_ours');
  }
  if (new Date(quote.extra.kosha.expiresAt) <= now) {
    return refuse('quote_expired');
  }

  const built = buildQuotedTransfer(quote, config.accountId, {
    maxTransactionFeeHbar: config.maxTransactionFeeHbar,
    validStart: now
  });
  if (!built.ok) {
    return refuse(built.data.reason);
  }
  const signed = await built.data.sign(config.privateKey);
  return { ok: true, data: { transaction: Buffer.from(signed.toBytes()).toString('base64') } };
};

// Registers into @x402/core's x402Client: client.register('hedera:testnet', koshaSplitScheme(config))
export const koshaSplitScheme = (config: SigningConfig): SchemeNetworkClient => ({
  scheme: SCHEMES.koshaSplit,
  createPaymentPayload: async (_x402Version, requirements): Promise<PaymentPayloadResult> => {
    const signed = await signSplitPayment(requirements, config);
    if (!signed.ok) {
      throw new KoshaPayRefusal(signed.data.reason);
    }
    return { x402Version: X402_VERSION, payload: { transaction: signed.data.transaction } };
  }
});
