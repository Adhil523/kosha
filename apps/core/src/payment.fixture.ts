import { hashApiKey } from './auth';
import type { KoshaDb } from './db/client';
import { agent, agentWallet, quote, receiver, receiverWallet } from './db/schema';
import type { SettleDeps } from './payment-settle';
import type { VerifyDeps } from './payment-verify';
import type { PayerKeyLookup } from '@kosha/hedera/payer-key';
import { PAYER_KEY, QUOTE, VALID_START } from '@kosha/hedera/transfer-verifier.fixture';
import { X402_VERSION } from '@kosha/shared/headers';
import type { PaymentPayload } from '@kosha/shared/x402-payment';

// The spec's sample payment, stored the way /v1/quote stores it: payer 0.0.6001 pays 0.10 USDC to
// receiver wallet 0.0.5001 and 1019 micro-USDC of TDS into its reserve 0.0.6101. The quote matches
// @kosha/hedera's verifier fixture, so signedVariant() signs real transactions against it.

export const RECEIVER_API_KEY = `key-receiver-${'k'.repeat(32)}`;
export const RECEIVER_AUTH = { authorization: `Bearer ${RECEIVER_API_KEY}` };
export const QUOTE_ID = QUOTE.extra.kosha.quoteId;
export const ISSUED_AT = new Date(VALID_START.getTime() - 5_000);
export const EXPIRES_AT = new Date(VALID_START.getTime() + 115_000);

export const seedQuotedPayment = async (db: KoshaDb) => {
  const [payee] = await db
    .insert(receiver)
    .values({
      legalName: 'Demo Data Pvt Ltd',
      residency: 'resident',
      specifiedPerson: false,
      mode: 'threshold',
      unverifiedPolicy: 'threshold_tolerant',
      apiKeyHash: hashApiKey(RECEIVER_API_KEY)
    })
    .returning();
  const [payer] = await db
    .insert(agent)
    .values({
      identity: 'hedera:testnet:0.0.6001',
      level: 1,
      residency: 'resident',
      panOnFile: true,
      reserveAccountID: '0.0.6101'
    })
    .returning();
  if (!payee || !payer) throw new Error('[payment-fixture]: seed rows were not saved');

  await db.insert(receiverWallet).values({
    receiverID: payee.id,
    accountID: '0.0.5001',
    proofSignature: 'ff',
    verifiedAt: ISSUED_AT
  });
  await db.insert(agentWallet).values({ agentID: payer.id, accountID: '0.0.6001' });
  await db.insert(quote).values({
    id: QUOTE_ID,
    createdAt: ISSUED_AT,
    scheme: 'kosha_split',
    receiverID: payee.id,
    agentID: payer.id,
    resource: 'https://api.demo-in.dev/v1/gst-lookup',
    payToAccountID: '0.0.5001',
    reserveAccountID: '0.0.6101',
    priceMicro: 100_000n,
    tdsMicro: 1_019n,
    totalMicro: 101_019n,
    inrValuePaise: 884n,
    rateBps: 100,
    reason: 'threshold_crossed',
    rulepack: QUOTE.extra.kosha.tax.rulepack,
    inrPerUsdMicro: 88_400_000n,
    nodeAccountIDs: [...QUOTE.extra.kosha.nodeAccountIds],
    fy: '2026-27',
    expiresAt: EXPIRES_AT
  });
  return { receiverId: payee.id, agentId: payer.id };
};

export const payloadFor = (transaction: string): PaymentPayload => ({
  x402Version: X402_VERSION,
  accepted: QUOTE,
  payload: { transaction }
});

export const fixedPayerKey: PayerKeyLookup = async () => ({ ok: true, data: PAYER_KEY.publicKey });

// Verify's dependencies, plus the two settle adds for compatibility mode
type PaymentDeps = VerifyDeps & Pick<SettleDeps, 'network' | 'poolReserveAccountId'>;

export const verifyDeps = (db: KoshaDb, overrides: Partial<PaymentDeps> = {}): PaymentDeps => ({
  db,
  feePayer: '0.0.4000',
  settlementTokenId: '0.0.429274',
  maxTransactionFeeHbar: '2',
  compatSettlementAccountId: '0.0.4200',
  network: 'testnet',
  poolReserveAccountId: '0.0.4300',
  payerKey: fixedPayerKey,
  tokenBalance: async () => ({ ok: true, data: 1_000_000_000n }),
  now: () => VALID_START,
  ...overrides
});
