import { parsePrivateKey } from '@kosha/hedera/client';
import { buildQuotedTransfer } from '@kosha/hedera/quoted-transfer';
import { loadEnv } from '@kosha/shared/env';
import { verifyResponseSchema } from '@kosha/shared/facilitator-api';
import { SCHEMES, X402_VERSION } from '@kosha/shared/headers';
import { accountIdSchema, hederaNetworkSchema, topicIdSchema } from '@kosha/shared/ids';
import { hashscanTopic } from '@kosha/shared/links';
import { formatUsdc } from '@kosha/shared/money';
import {
  type KoshaSplitRequirements,
  paymentRequiredSchema,
  settlementResponseSchema
} from '@kosha/shared/x402-payment';
import { z } from 'zod';

// `pnpm smoke-settle [--price <usdc>]` (A10): one real split payment on testnet without Gate.
// agent-resident asks Core for a quote from receiver-in, signs it with buildQuotedTransfer (the
// same function Kosha Pay signs with), then Core verifies and settles it. Needs a running Core
// and `pnpm seed --profiles`. A price over the ₹10,000 threshold (about 113 USDC at ₹88.40)
// crosses it, so the transaction shows both legs: the price to the API and the TDS to the reserve.

const DEFAULT_PRICE_USDC = '0.10';
const USDC_PATTERN = /^(\d+)(?:\.(\d{1,6}))?$/;
const MICRO_DIGITS = 6;
const RESOURCE = { url: 'https://api.demo-in.dev/v1/gst-lookup', description: 'GSTIN lookup' };

const envSchema = z.object({
  HEDERA_NETWORK: hederaNetworkSchema,
  CORE_URL: z.url(),
  DEMO_API_IN_KEY: z.string().min(32),
  AGENT_RESIDENT_ACCOUNT_ID: accountIdSchema,
  AGENT_RESIDENT_PRIVATE_KEY: z.string().min(1),
  HCS_PAYMENTS_TOPIC: topicIdSchema,
  MAX_TX_FEE_HBAR: z.string().min(1)
});

const usdcToMicro = (text: string): bigint | null => {
  const match = USDC_PATTERN.exec(text);
  if (!match?.[1]) return null;
  const fraction = (match[2] ?? '').padEnd(MICRO_DIGITS, '0');
  return BigInt(match[1]) * 10n ** BigInt(MICRO_DIGITS) + BigInt(fraction);
};

const priceArgument = (args: string[]): string => {
  const index = args.indexOf('--price');
  return index >= 0 ? (args[index + 1] ?? '') : DEFAULT_PRICE_USDC;
};

const main = async (): Promise<void> => {
  const loaded = loadEnv();
  if (!loaded.ok) throw new Error(`no pnpm workspace found above ${loaded.data.searchedFrom}`);
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
    throw new Error(`set these env keys (pnpm bootstrap, then pnpm seed --profiles): ${keys}`);
  }
  const env = parsed.data;
  const price = usdcToMicro(priceArgument(process.argv.slice(2)));
  if (price === null || price === 0n) throw new Error('--price takes a USDC amount, e.g. 0.10');
  const payerKey = parsePrivateKey(env.AGENT_RESIDENT_PRIVATE_KEY);
  if (!payerKey.ok) throw new Error('AGENT_RESIDENT_PRIVATE_KEY is not a usable key');

  const core = async (path: string, body: unknown): Promise<unknown> => {
    const response = await fetch(`${env.CORE_URL.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.DEMO_API_IN_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const json: unknown = await response.json();
    if (!response.ok)
      throw new Error(`${path} answered ${response.status}: ${JSON.stringify(json)}`);
    return json;
  };

  const quoted = paymentRequiredSchema.parse(
    await core('/v1/quote', {
      method: 'GET',
      resource: RESOURCE,
      priceMicroUsdc: price.toString(),
      agent: `hedera:${env.HEDERA_NETWORK}:${env.AGENT_RESIDENT_ACCOUNT_ID}`
    })
  );
  const accepted = quoted.accepts.find(
    (entry): entry is KoshaSplitRequirements => entry.scheme === SCHEMES.koshaSplit
  );
  if (!accepted) throw new Error('the quote has no kosha-split entry');
  const { quoteId, tax, totalMicro, transfers } = accepted.extra.kosha;
  console.info(
    `[smoke-settle]: quote ${quoteId}: ${formatUsdc(BigInt(totalMicro))} USDC in total, ` +
      `TDS ${formatUsdc(BigInt(tax.tdsMicroUsdc))} at ${tax.rateBps} bps (${tax.reason}), ` +
      `${transfers.length} leg(s)`
  );

  const built = buildQuotedTransfer(accepted, env.AGENT_RESIDENT_ACCOUNT_ID, {
    maxTransactionFeeHbar: env.MAX_TX_FEE_HBAR
  });
  if (!built.ok) throw new Error(`could not build the transfer: ${built.data.reason}`);
  const signed = await built.data.sign(payerKey.data);
  const body = {
    x402Version: X402_VERSION,
    paymentPayload: {
      x402Version: X402_VERSION,
      resource: RESOURCE,
      accepted,
      payload: { transaction: Buffer.from(signed.toBytes()).toString('base64') }
    },
    paymentRequirements: accepted
  };

  const verified = verifyResponseSchema.parse(await core('/v1/verify', body));
  if (!verified.isValid) {
    throw new Error(
      `verify refused it: ${verified.extra?.kosha.errorCode ?? verified.invalidReason}`
    );
  }
  console.info(`[smoke-settle]: verified; payer ${verified.payer ?? 'unknown'}`);

  const settled = settlementResponseSchema.parse(await core('/v1/settle', body));
  if (!settled.success || !settled.extensions) {
    throw new Error(
      `settle failed: ${settled.errorReason ?? 'unknown'} ${settled.errorMessage ?? ''}`
    );
  }
  console.info(`[smoke-settle]: settled ${settled.transaction}`);
  console.info(`[smoke-settle]: HashScan ${settled.extensions.kosha.hashscanUrl}`);
  console.info(
    `[smoke-settle]: the HCS record follows within seconds on ` +
      hashscanTopic(env.HEDERA_NETWORK, env.HCS_PAYMENTS_TOPIC)
  );
};

main().catch((error: unknown) => {
  console.error('[smoke-settle]: failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
