import { parsePrivateKey } from '@kosha/hedera/client';
import { loadEnv } from '@kosha/shared/env';
import { accountIdSchema, hederaNetworkSchema, tokenIdSchema } from '@kosha/shared/ids';
import { decodePaymentResponseHeader, wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { createClientHederaSigner, ExactHederaScheme } from '@x402/hedera';
import { z } from 'zod';

// `pnpm smoke-compat [url]` (A23, opt-in, testnet): a stock x402 v2 client pays a Kosha endpoint
// through compatibility mode. It is the official @x402/fetch with the official Hedera `exact`
// scheme: no Kosha code and no X-KOSHA-AGENT. Gate answers the 402 with the compatibility entry,
// Core settles the payment into Kosha's settlement account, and the forwarder then moves the
// price to the API and the TDS to the pooled reserve in a second transaction.
//
// Needs Core, demo-api-in and `pnpm seed --profiles`. Pays as agent-unknown, whose account the
// seed registered, so Core books the payment to it.

const MAX_MICRO_PER_PAYMENT = '1000000';
const DEFAULT_URL = 'http://localhost:4101/v1/gst-lookup?gstin=29AAKCK4821M1ZQ';

const envSchema = z.object({
  HEDERA_NETWORK: hederaNetworkSchema,
  AGENT_UNKNOWN_ACCOUNT_ID: accountIdSchema,
  AGENT_UNKNOWN_PRIVATE_KEY: z.string().min(1),
  SETTLEMENT_TOKEN_ID: tokenIdSchema
});

const main = async (): Promise<void> => {
  const loaded = loadEnv();
  if (!loaded.ok) throw new Error(`no pnpm workspace found above ${loaded.data.searchedFrom}`);
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
    throw new Error(`set these env keys (run pnpm bootstrap): ${keys.join(', ')}`);
  }
  const env = parsed.data;
  const url = process.argv[2] ?? DEFAULT_URL;

  const key = parsePrivateKey(env.AGENT_UNKNOWN_PRIVATE_KEY);
  if (!key.ok) throw new Error('AGENT_UNKNOWN_PRIVATE_KEY is not a usable key');
  // @x402/hedera uses the same @hiero-ledger/sdk version, so the key is its PrivateKey too
  const signer = createClientHederaSigner(env.AGENT_UNKNOWN_ACCOUNT_ID, key.data, {
    network: `hedera:${env.HEDERA_NETWORK}`
  });
  const network = `hedera:${env.HEDERA_NETWORK}` as const;
  // Stock clients pay only default assets (Circle USDC) unless told otherwise; development runs
  // on bootstrap's tUSDC, so allow it, capped at 1 USDC a payment
  const paidFetch = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network, client: new ExactHederaScheme(signer) }],
    spendControls: {
      allowedAssets: [
        { network, asset: env.SETTLEMENT_TOKEN_ID, maxAmountPerPayment: MAX_MICRO_PER_PAYMENT }
      ]
    }
  });

  console.info(`[smoke-compat]: GET ${url} as ${env.AGENT_UNKNOWN_ACCOUNT_ID}, no Kosha headers`);
  const response = await paidFetch(url);
  const header = response.headers.get('PAYMENT-RESPONSE');
  if (!response.ok || !header) {
    throw new Error(`the API answered ${response.status}: ${await response.text()}`);
  }
  const settlement = decodePaymentResponseHeader(header);
  console.info(`[smoke-compat]: paid ${settlement.amount ?? '?'} micro-USDC`);
  console.info(`[smoke-compat]: transaction ${settlement.transaction}`);
  console.info(`[smoke-compat]: X-KOSHA-TAX ${response.headers.get('X-KOSHA-TAX') ?? '(none)'}`);
  console.info('[smoke-compat]: the forward follows within seconds; check the ledger or HashScan');
};

main().catch((error: unknown) => {
  console.error('[smoke-compat]: failed', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
