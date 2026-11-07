# Chainlink CRE for the INR rate

**Answer:** Kosha can qualify for Chainlink's "Best workflow with CRE" prize at ETHGlobal Mumbai
($1,500) with a CRE workflow that supplies Core's INR/USD rate. CRE does **not** support Hedera, so
the workflow's on-chain read is Chainlink's **INR/USD feed on Polygon mainnet**, cross-checked
against an off-chain reference rate. The workflow sends Core a DON-signed report over HTTP, and
Core verifies it before using the rate. A local simulation is enough for the prize. The CCIP track
is out: it requires CCIP "inside your smart contracts", and Kosha has none.

**Built:** see [cre/README.md](../../cre/README.md). **Recommendation (as researched):** build the `kosha-fx` workflow below and add a `chainlink-cre` FX source to Core,
replacing the fixed demo rate (`FX_DEMO_INR_PER_USD=88.40`; the feed read ₹94.49 on 2026-11-06).

## Sources (checked 2026-11-07)

- CRE docs source: https://github.com/smartcontractkit/documentation/tree/main/src/content/cre
  (`supported-networks-ts.mdx`, last modified 2026-10-19, and `llms-full-ts.txt`, the full
  TypeScript docs). docs.chain.link itself returns 404 to automated fetches.
- Chainlink feed directory: `https://reference-data-directory.vercel.app/feeds-<network>.json` for
  `mainnet`, `matic-mainnet`, `ethereum-testnet-sepolia`, `hedera-testnet` and others
- A live `latestRoundData()` call on Polygon through `https://polygon-bor-rpc.publicnode.com`
- Prize page: https://ethglobal.com/events/mumbai/prizes/chainlink

## The prize

"Best workflow with CRE", $1,500. The workflow must be built, simulated or deployed "as an
orchestration layer within your project" ("simulation is enough"), integrate at least one
blockchain with an external API, system, data source, LLM or AI agent, and be "meaningfully used in
your project".

## Networks

| Question          | Answer                                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hedera in CRE?    | **No.** Not in the mainnet or testnet tables, and not mentioned anywhere in the CRE docs. A workflow can reach Hedera only through HTTP (the Mirror Node REST API).                                                |
| What CRE supports | About 25 EVM mainnets (Ethereum, Arbitrum, Base, Polygon, …), about 33 EVM testnets (Sepolia, Base Sepolia, Polygon Amoy, …) and Solana. `cre workflow supported-chains` lists what your organization has enabled. |
| Polygon caveat    | Marked `*`: "Safe and finalized reads are not reliably supported". Read at the latest block.                                                                                                                       |

## Chainlink price feeds

| Feed       | Network          | Proxy                                        | Decimals | Heartbeat | Deviation |
| ---------- | ---------------- | -------------------------------------------- | -------- | --------- | --------- |
| INR / USD  | Polygon mainnet  | `0xDA0F8Df6F5dB15b346f4B8D1156722027E194E60` | 8        | 86,400 s  | 1%        |
| USDC / USD | Hedera testnet   | `0xb632a7e7e02d76c0Ce99d9C62c7a2d1B5F92B6B5` | n/a      | 86,400 s  | 0.5%      |
| USDC / USD | Ethereum Sepolia | `0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E` | n/a      | 86,400 s  | 1%        |

- INR/USD exists only on Polygon mainnet among the networks checked (Ethereum, Sepolia, Arbitrum,
  Base, Polygon, Hedera mainnet and testnet). No shutdown date; asset class `Fiat`, market hours
  `Forex_INR`.
- Live read on 2026-11-06 03:28:07 UTC: answer `1058300` = 0.010583 USD per INR = **₹94.4912 per
  USD**.
- The feed is quoted as USD per INR, so Kosha's `inrPerUsdMicro` is `1e8 / answer`, scaled.

## Access and tooling

| Item       | What the docs say                                                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account    | Free Chainlink Platform account at app.chain.link/cre/discover                                                                                       |
| Simulation | Needs the CRE CLI and `cre login`. "Simulation … makes real calls to live APIs and public EVM blockchains." No gas for reads.                        |
| Deployment | Needs Early Access (`cre account access`). Not needed for the prize.                                                                                 |
| TypeScript | `@chainlink/cre-sdk`; workflows compile to WASM through Javy. Bun 1.2.21 or later is required ("the TypeScript SDK uses Bun for compilation").       |
| Secrets    | From `.env` or environment variables in simulation; `runtime.getSecret()` inside a handler, never at registration                                    |
| Triggers   | Cron, HTTP, EVM log, Solana log. Run one handler without prompts: `cre workflow simulate <wf> --non-interactive --trigger-index 0 --target <target>` |

## Getting the rate to Core

- **HTTP client.** GET and POST; every request is wrapped in node consensus (median or identical
  aggregation). For a POST, use `cacheSettings` so only one node sends it. Use `runtime.now()`, not
  `Date.now()`. Redirects (3xx) fail.
- **Signed reports over HTTP.** `runtime.report()` produces a DON-signed report, and `sendReport()`
  POSTs it to any endpoint with three hex fields: `report`, `context`, `signatures`. The receiver
  verifies the signatures with standard crypto against the Capability Registry ("Verifying outside
  CRE"), so Core needs no contract.
- **Simulation caveat.** The simulator signs with local test keys, so a sim-signed report fails the
  default production check ("simulator DON keys do not match mainnet registry signers"). In the demo,
  Core accepts the simulator's signers behind an explicit flag and labels the rate as simulated.

## Design

```text
cron ─▶ kosha-fx workflow (CRE)
          ├─ EVM read: INR/USD latestRoundData() on Polygon mainnet
          ├─ HTTP GET: reference INR/USD rate (median across nodes)
          ├─ refuse if they differ by more than the configured band
          └─ runtime.report() ─▶ sendReport() ─▶ POST Core /v1/fx/report
Core ─▶ verify signatures ─▶ store rate, sources, report hash ─▶ FxSource "chainlink-cre"
     ─▶ quotes use it; GET /v1/fx shows the rate and its source
```

## Risks

- **No Hedera read.** The prize's blockchain requirement is met on Polygon; the result decides tax
  on Hedera.
- **Which rate the law expects.** Findings §9 notes the SBI TT buying rate is common practice; the
  Chainlink feed is a market rate. Frame the feed as the on-chain cross-check, and confirm the rate
  with a CA. No reliable public SBI rate API has been found yet.
- **Stale or missing rate.** Core falls back to the rule pack's configured source and says so,
  instead of quoting with an old rate.
