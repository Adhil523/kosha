# @kosha/gate

Charge AI agents per request, with Indian TDS handled for you. Kosha Gate answers unpaid requests
to your priced routes with an x402 v2 `402 Payment Required` quote from Kosha Core, and lets a paid
request through once Core has verified and settled it on Hedera.

## Express

```ts
import express from 'express';
import { koshaGate } from '@kosha/gate';

const app = express();
app.use(
  koshaGate({
    core: 'https://core.kosha.dev',
    apiKey: process.env.KOSHA_API_KEY ?? '', // identifies you, the receiver, in Core
    routes: {
      // Net prices in USDC: you receive exactly this; any TDS is added on top for the payer
      'GET /v1/gst-lookup': { priceUsdc: '0.10', description: 'GSTIN lookup' },
      'GET /v1/company/:cin': { priceUsdc: '0.25' }
    }
  })
);

app.get('/v1/gst-lookup', (req, res) => {
  res.json({ ok: true, paidBy: req.kosha?.agentId });
});
```

| Option               | Meaning                                                                                                                                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core`, `apiKey`     | Kosha Core's URL and your receiver API key                                                                                                                                                                                                                                                                                     |
| `routes`             | `'METHOD /path/:param'` → `{ priceUsdc, description?, mimeType? }`. Unlisted routes are free.                                                                                                                                                                                                                                  |
| `settleMode`         | `'before'` (default): settle before your handler runs, so data is never served unpaid. `'after'`: verify first, run your handler, and settle only if it answered 2xx.                                                                                                                                                          |
| `onSettled(kosha)`   | Called with the settlement (`txId`, `tdsMicroUsdc`, `hcsSequence`, `reserveProof`, …)                                                                                                                                                                                                                                          |
| `onChainProof`       | Default on: after settling, read the transaction from the Mirror Node and refuse (`402 amount_mismatch`) unless the payer's reserve got the quoted TDS. Mirror Node lag past 10 s still serves, with `reserveProof: 'unconfirmed'`. Pass `{ mirrorUrl, timeoutMs }` to tune it, or `false` to skip it (the burst script does). |
| `timeoutMs`, `fetch` | Core request timeout (default 10 s) and a `fetch` override                                                                                                                                                                                                                                                                     |

A settled request carries `req.kosha` (with `settleMode: 'before'`) and the response headers
`PAYMENT-RESPONSE` and `X-KOSHA-TAX`. A failed payment gets a `402` with a Kosha error code; Core
being unreachable gets a `503`.

## Any other framework

`createGateHandler(options)` from `@kosha/gate/gate-handler` takes `{ method, url, headers }` and
returns `next`, `respond` or `pass`; see `src/express-middleware.ts` for a complete adapter.

## Build

`pnpm --filter @kosha/gate build` writes ESM, CJS and type declarations to `dist/`, with
`@kosha/shared` bundled in. Inside this workspace, other packages import the TypeScript source.
