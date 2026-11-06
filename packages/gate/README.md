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

| Option                                  | Meaning                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core`, `apiKey`                        | Kosha Core's URL and your receiver API key                                                                                                                                                                                                                                                                                     |
| `routes`                                | `'METHOD /path/:param'` → `{ priceUsdc, description?, mimeType? }`. Unlisted routes are free.                                                                                                                                                                                                                                  |
| `settleMode`                            | `'before'` (default): settle before your handler runs, so data is never served unpaid. `'after'`: verify first, run your handler, and settle only if it answered 2xx.                                                                                                                                                          |
| `onSettled(kosha)`                      | Called with the settlement (`txId`, `tdsMicroUsdc`, `hcsSequence`, `reserveProof`, …)                                                                                                                                                                                                                                          |
| `onChainProof`                          | Default on: after settling, read the transaction from the Mirror Node and refuse (`402 amount_mismatch`) unless the payer's reserve got the quoted TDS. Mirror Node lag past 10 s still serves, with `reserveProof: 'unconfirmed'`. Pass `{ mirrorUrl, timeoutMs }` to tune it, or `false` to skip it (the burst script does). |
| `timeoutMs`, `settleTimeoutMs`, `fetch` | Core timeout for quote and verify (default 10 s), for settle (default 75 s, which outlasts Core's receipt and Mirror Node wait), and a `fetch` override                                                                                                                                                                        |

A settled request carries `req.kosha` (with `settleMode: 'before'`) and the response headers
`PAYMENT-RESPONSE` and `X-KOSHA-TAX`. A failed payment gets a `402` with a Kosha error code and,
when signing again can fix it, a fresh quote in `PAYMENT-REQUIRED`. There is none after
`settlement_pending`, `replay` or a `policy_*` refusal, so the payer is not invited to pay twice.
Core being unreachable gets a `503`.

## Hono

The same options, for Hono on Node, Bun, Deno or Cloudflare Workers:

```ts
import { Hono } from 'hono';
import { koshaHono, type KoshaHonoEnv } from '@kosha/gate/hono-middleware';

const app = new Hono<KoshaHonoEnv>();
app.use(
  koshaHono({
    core: 'https://core.kosha.dev',
    apiKey: process.env.KOSHA_API_KEY ?? '',
    routes: { 'GET /v1/gst-lookup': { priceUsdc: '0.10' } }
  })
);

app.get('/v1/gst-lookup', (c) => c.json({ ok: true, paidBy: c.get('kosha')?.agentId }));
```

`hono` and `express` are optional peer dependencies: install the one you use.

## Any other framework

`createGateHandler(options)` from `@kosha/gate/gate-handler` takes `{ method, url, headers }` and
returns `next`, `respond`, `pass` or `verified`; see `src/hono-middleware.ts` for a short, complete
adapter.

## Build

`pnpm --filter @kosha/gate build` writes ESM, CJS and type declarations to `dist/`, with
`@kosha/shared` bundled in. Inside this workspace, other packages import the TypeScript source.
