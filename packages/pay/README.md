# @kosha/pay

A drop-in `fetch` for AI agents that pays x402 `402 Payment Required` responses in USDC on
Hedera, with Indian TDS reserved in the agent's own account. Pay checks every quote against the
owner's spending rules and signs exactly the quoted transfers, nothing else.

```ts
import { createKoshaPay } from '@kosha/pay';

const pay = createKoshaPay({
  network: 'testnet',
  accountId: process.env.AGENT_ACCOUNT_ID ?? '',
  privateKey: process.env.AGENT_PRIVATE_KEY ?? '',
  reserveAccountId: process.env.AGENT_RESERVE_ID ?? '', // the agent's own 2-of-2 TDS reserve
  asset: process.env.SETTLEMENT_TOKEN_ID ?? '',
  trustedFacilitators: [process.env.CORE_ACCOUNT_ID ?? ''],
  policy: {
    perPaymentUsdc: '0.50',
    dailyUsdc: '5',
    fyBudgetUsdc: '200',
    allowlist: ['api.demo-in.dev'],
    onThreshold: 'warn'
  }
});

const response = await pay.fetch('https://api.demo-in.dev/v1/gst-lookup?gstin=29AAKCK4821M1ZQ');
console.info(await response.json(), pay.lastReceipt); // { txId, hashscanUrl, tdsMicroUsdc, … }
```

## What Pay checks before it signs

- The host is on the allowlist, the rule pack is accepted, and the all-in total (price plus TDS)
  fits the per-payment, daily and financial-year caps.
- The `kosha-split` quote: `amount` is the consideration leg to `payTo`, the legs sum to the total,
  the memo names the quote, and the TDS leg credits **this agent's own reserve**.
- The token, network and fee payer (one of `trustedFacilitators`), and that the quote hasn't expired.

When Pay won't pay, `pay.fetch()` returns the server's 402 unchanged and `pay.lastError` says why.

## Two steps

`pay.prepare(url)` fetches and, on a 402, checks and signs the quote without sending it.
`pay.complete(payment)` retries once with `PAYMENT-SIGNATURE`. The Agent Kit plugin uses the two
steps so a budget policy can run between them. Both return results (`{ ok, data }`) rather than
throwing.

## With a stock x402 client

`koshaSplitScheme(config)` from `@kosha/pay/kosha-split-scheme` registers the same signing into
`@x402/core`'s `x402Client`: `client.register('hedera:testnet', koshaSplitScheme(config))`.

## Build

`pnpm --filter @kosha/pay build` writes ESM, CJS and type declarations to `dist/`, with
`@kosha/shared`, `@kosha/hedera` and `@kosha/tax-engine` bundled in.
