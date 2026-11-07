# kosha-fx: Chainlink CRE for Kosha's INR rate

Every tax decision turns on a payment's rupee value, so Core needs a trustworthy INR/USD rate.
`kosha-fx` is a [Chainlink Runtime Environment](https://docs.chain.link/cre) workflow that supplies
it. Research and sources: [docs/research/chainlink-cre.md](../docs/research/chainlink-cre.md).

```text
cron ─▶ kosha-fx (CRE workflow, TypeScript → WASM)
          ├─ EVM read: Chainlink INR/USD latestRoundData() on Polygon mainnet
          │    0xDA0F8Df6F5dB15b346f4B8D1156722027E194E60 (CRE has no Hedera support)
          ├─ HTTP GET: the ECB reference rate (api.frankfurter.dev), median across nodes
          ├─ refuse if the two differ by more than maxDeviationBps (200 = 2%)
          └─ runtime.report() ─▶ sendReport() ─▶ POST Core /v1/fx/report
Core ─▶ recover the DON signatures ─▶ apply the rate ─▶ quotes use it (GET /v1/fx shows it)
```

- The rate is Chainlink's feed, inverted to micro-rupees per USD and rounded **up**, so a payment
  is never under-valued. The ECB rate is the cross-check.
- Core keeps the rate while Chainlink's reading is under 26 hours old (the feed's heartbeat is
  24 hours), then falls back to `FX_DEMO_INR_PER_USD`. It never quotes with a stale rate.
- The rate lives in Core's memory; after a restart, Core quotes with the fallback until the next
  report.

## Run it

You need a free Chainlink account (app.chain.link/cre/discover), the CRE CLI (`cre login`) and Bun
1.2.21 or later.

```bash
cd cre/kosha-fx && bun install && bun test && cd ..

# Start Core with simulated reports allowed (repo root)
CRE_FX_TRUST=simulation pnpm --filter @kosha/core dev
curl localhost:4000/v1/fx            # source: demo-fixed

# Run the workflow once (from cre/)
cre workflow simulate kosha-fx --non-interactive --trigger-index 0 --target staging-settings
curl localhost:4000/v1/fx            # source: chainlink-cre-simulation, Chainlink's rate
```

`coreReportUrl` in `kosha-fx/config.staging.json` must match your Core's port (4000 by default).

## How Core trusts a report

Core recovers each signature over `keccak256(keccak256(report) || context)`, as the CRE docs'
offchain verification does, and counts distinct signers. `CRE_FX_TRUST` decides which signers
count:

| `CRE_FX_TRUST` | Counts                                                                 | Source label               | Use                                                                         |
| -------------- | ---------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------- |
| unset          | nothing; `/v1/fx/report` answers 503                                   | `demo-fixed`               | Default                                                                     |
| `simulation`   | any distinct signers, **only from this machine**                       | `chainlink-cre-simulation` | `cre workflow simulate`, which signs with fresh throwaway keys on every run |
| `signers`      | `CRE_FX_SIGNERS` (comma-separated addresses), at least f + 1 of 3f + 1 | `chainlink-cre`            | A deployed workflow: the DON's signers from Chainlink's Capability Registry |

A simulated report proves the workflow ran and what it read; it can't prove a Chainlink DON signed
it, so its rate is labelled as simulated. A deployed workflow needs CRE Early Access.
