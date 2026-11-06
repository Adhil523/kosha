# Agent B queue: edges

You own research, the tax engine, the testnet bootstrap, Kosha Gate, Kosha Pay, the demo APIs, the demo agent, Kosha Console, the README and the demo scripts. You work in the `kosha-b` worktree. Work through this queue with the loop in [PROTOCOL.md §5](PROTOCOL.md#5-the-task-loop). The planned commits are a guide to size and order; split or merge them if the code calls for it, but keep each one small.

Each card reads: **branch** · **depends on** (a **bold** ID belongs to Agent A) · **unblocks**. "Spec" means [Kosha Execution Plan.md](../../Kosha%20Execution%20Plan.md).

Agent A waits on three of your tasks: **B00** (before A02), **B02** (before A09) and **B03** (before A10). Open those PRs as soon as they are ready, and say so in the READY line.

---

## Phase 0 and 1: foundations

### B00 · Research the moving parts
`b/00-research` · depends on: none (start immediately; no `package.json` exists yet) · unblocks: **A02**, and informs A08, A18, B13, B23

Each file in `docs/research/` is at most one page. It covers:

- the answer
- source links
- exact package versions
- a snippet that matches the current API
- **what it changes in the spec**

Use web search and official docs. Don't install anything. One commit per file:

1. `docs(research): x402`: the current x402 version and its header names, the 402 body and payment-payload field names, the network identifier for Hedera testnet, and any existing Hedera x402 facilitator worth aligning with. **A02 is built from this file.**
2. `docs(research): hedera usdc`: Circle's testnet USDC token ID and decimals, the faucet and its limits, and the association rules.
3. `docs(research): scheduled transactions`: whether long-term scheduled transactions (HIP-423, `setWaitForExpiry`) work on testnet today, and the maximum expiry.
4. `docs(research): hcs-14`: the `@hashgraphonline/standards-sdk` version, how to create an HCS-14 agent identity, how to add a custom `kosha` profile field, and the HCS-11 fallback.
5. `docs(research): hedera agent kit`: the `hedera-agent-kit` version, how to register a custom LangChain tool or plugin, and the supported LLM providers.

### B01 · Rule pack, loader and calendar helpers
`b/01-rulepack` · depends on: **A01** · unblocks: B02

1. `feat(tax-engine): rule pack schema`: a Zod `RulePack` following the spec, plus a `receiverNonResident: "no_tds_flag_fema"` field, with types.
2. `feat(tax-engine): in-2026.1 rule pack`
   - `rulepacks/in-2026.1.json` and `loadRulePack()`, which validates.
   - `rulepackMatches(id, patterns)` for Pay's `acceptRulepacks` globs.
3. `feat(tax-engine): IST calendar`
   - `financialYear(date)` returns, for example, `"2026-27"`.
   - `istDayKey(date)` for daily caps.
   - `quarterOf(date)`.
   - Tests at the boundary: `2027-03-31T18:29:59Z` versus `18:30:00Z`.
4. `feat(tax-engine): integer math`: `ceilDiv`, and conversions between paise and micro-USDC that always round up. Tests.

### B02 · `decide()` and `applyFunding()`
`b/02-decide` · depends on: B01 · unblocks: **A09** (Agent A's quote service waits on this)

1. `feat(tax-engine): decide()`
   - The spec's function, plus a `receiver.residency` input: a non-resident receiver means no TDS with the `fema_review` flag.
   - It returns `valuePaise`, `tdsPaise`, `tdsMicroUsdc`, `rateBps`, `reason` and `flags`.
2. `test(tax-engine): threshold and crossing`: under, at and over both thresholds, with both `full` and `excess` crossing.
3. `test(tax-engine): rates and residency`: PAN versus no PAN, unknown payer (20% from the first rupee), non-resident payer, non-resident receiver, and first-rupee mode.
4. `test(tax-engine): rounding properties` with `fast-check`:
   - TDS is never below the exact rate × value.
   - TDS never decreases as value rises.
   - Cover a 1-micro price and very large prices.
5. `feat(tax-engine): applyFunding()`: `payer` or `price_inclusive` returns `{ receiverMicro, escrowMicro, payerTotalMicro }`. Tests.

**Done when** there are at least 30 example tests plus the property tests, all green.

### B03 · Testnet bootstrap
`b/03-bootstrap` · depends on: **A01**, and human step H2 (operator account in `kosha.env`) · unblocks: **A10**

`scripts/bootstrap.ts` is idempotent: it skips anything whose ID is already in the env file. Run it for real before marking the PR ready.

1. `feat(scripts): env file updater`
   - In `scripts/lib/`, read and update keys in the file `.env` points to (follow the symlink).
   - Never print secrets.
2. `feat(scripts): settlement token`: if `SETTLEMENT_TOKEN_ID` is empty, create `tUSDC` (6 decimals, Core as treasury).
3. `feat(scripts): demo accounts`
   - Create `receiver-in`, `receiver-global`, `agent-resident`, `agent-specified`, `agent-nonresident`, `agent-unknown`, `compliance`, and `escrow` with a 2-of-2 `KeyList` (Core + compliance).
   - Associate the token with every account.
   - Fund the agents with the token and a little HBAR.
4. `feat(scripts): topics and secrets`
   - Create the payments and profiles HCS topics.
   - Generate `DEMO_API_IN_KEY`, `DEMO_API_GLOBAL_KEY`, `ISSUER_PRIVATE_KEY`, `PAIR_HMAC_SECRET`, `PAN_COMMIT_SECRET` and `CONSOLE_ADMIN_TOKEN`.
5. `docs(scripts): testnet account table`: print the account table and write `docs/testnet-accounts.md` (IDs and HashScan links only, no keys).

### B04 · Gate: framework-agnostic handler
`b/04-gate-core` · depends on: **A02** · unblocks: B05

1. `feat(gate): core client`: quote, verify and settle calls with the API key and timeouts, typed by `@kosha/shared`.
2. `feat(gate): route matching and pricing`: patterns like `GET /v1/gst-lookup` and `:param`, with USDC price strings converted to micro-units.
3. `feat(gate): createGateHandler()`
   - Takes a generic request and returns either a response (`status`, `headers`, `body`) or "pass through" with `kosha` context.
   - Unpaid request: quote, then 402.
   - Paid request: verify, then settle, then pass through with the payment-response and `X-KOSHA-TAX` headers.
   - Failure: 402 with an error code.
4. `test(gate): handler against a fake Core`
   - 402 body shape
   - happy path
   - every verifier error code
   - replay
   - Core unreachable returns 503

### B05 · Gate: Express adapter and build
`b/05-gate-express` · depends on: B04 · unblocks: B06, B21

1. `feat(gate): koshaGate() express middleware`: sets `req.kosha` and supports `settleMode` `before` (the default) or `after`.
2. `test(gate): supertest suite`
3. `chore(gate): tsup build`: ESM, CJS and type declarations, bundling `@kosha/shared`, with a usage snippet in the package README.

### B06 · Demo APIs
`b/06-demo-apis` · depends on: B05 · unblocks: B12

1. `feat(demo-api): Indian GST lookup API`
   - `apps/demo-api-in` on Express, with a mock dataset of about 10 companies.
   - `GET /v1/gst-lookup` costs 0.10 USDC; `GET /v1/company/:cin` costs 0.25.
   - Uses `DEMO_API_IN_KEY`.
2. `feat(demo-api): foreign API`: `apps/demo-api-global` at 0.05 USDC, using `DEMO_API_GLOBAL_KEY`.
3. `feat(demo-api): /.well-known/kosha terms`: rule pack, accepted funding modes and prices (static for now).

### B07 · Pay: policy engine
`b/07-pay-policy` · depends on: **A02**, B01 · unblocks: B08

1. `feat(pay): policy schema and spend store`: an in-memory store keyed by IST day and financial year, behind an interface.
2. `feat(pay): checkPolicy()`
   - Rules: allowlist host, per-payment cap, daily cap, FY budget (all including tax), `onThreshold` (`warn`, `block` or `allow`), and accepted rule packs (`rulepackMatches`).
   - Tests for each rule.

### B08 · Pay: paying fetch and signing
`b/08-pay-fetch` · depends on: B07, **A03** · unblocks: B12

1. `feat(pay): createKoshaPay() config`: validated with Zod, including a `trustedFacilitators` list.
2. `feat(pay): check the quote before signing`
   - Transfers sum to `maxAmountRequired`.
   - The asset matches.
   - The fee payer is trusted.
   - The memo carries the quote ID.
3. `feat(pay): pay 402 responses`
   - Fetch. On a 402, parse the requirements, run the policy, sign with `buildQuotedTransfer` from `@kosha/hedera`, and retry once with the payment header and `X-KOSHA-AGENT`.
   - Set `lastReceipt` from the payment-response header.
4. `test(pay): mocked 402 flows`: happy path, policy block, single retry, tampered quote refused.
5. `chore(pay): tsup build` that bundles the internal packages.

### B09 · Console: scaffold
`b/09-console-scaffold` · depends on: **A01** · unblocks: B10

1. `chore(console): generate Next.js app`: generated output only (latest stable, App Router, TypeScript, Tailwind v4), named `@kosha/console`.
2. `chore(console): add shadcn/ui`: init plus the generated components (button, card, table, badge, progress, tabs, dialog, tooltip, sonner).
3. `feat(console): workspace shell`
   - Layout and side navigation for the API owner, agent owner and CA workspaces.
   - Every route from spec Component 4 as an empty page.
4. `feat(console): demo sign-in`
   - `DEMO_AUTH=1` shows a picker and stores a cookie session.
   - Footer labels: "sample data", "rule pack unreviewed", "not tax advice".
5. `feat(console): rule-pack badge`: "in-2026.1 · unreviewed", from `/v1/supported` (falls back to a fixture).

---

## Phase 2: first split payment (Gate 2)

### B10 · Console: live payments feed and threshold counter
`b/10-console-feed` · depends on: B09, **A02** · unblocks: B11, B15, B16

These are demo-critical widgets 1 and 2 from the spec.

1. `feat(console): server-side Core data layer`
   - A server-only Core client using `CONSOLE_ADMIN_TOKEN`.
   - Route handlers `/api/ledger`, `/api/aggregates` and `/api/stream` (an SSE proxy).
   - `KOSHA_MOCK=1` serves the `@kosha/shared` fixtures and a fake stream.
2. `feat(console): live payments feed`
   - Columns: time, agent, price, TDS, rate, reason, and HashScan and HCS links.
   - Updates over SSE, falling back to polling every 3 seconds.
3. `feat(console): threshold counter`
   - A progress bar towards ₹10,000 that turns amber at 90%.
   - Once crossed, rows read "1% withheld".
   - Amounts show in USDC and ₹, with the FX rate in a tooltip.

### B11 · Console: overview and counterparties
`b/11-console-overview` · depends on: B10 · unblocks: B14

1. `feat(console): overview cards`: earnings today and this month, TDS withheld, escrow balance, payments per minute.
2. `feat(console): counterparties`: per-payer progress bars, residency badge and credential status.

### B12 · First split payment, end to end (Gate 2)
`b/12-pay-once` · depends on: B06, B08, **A11** · unblocks: B13, B17, B18 · **This is Gate 2. Tell the human the moment it passes.**

1. `feat(scripts): pay-once`: `agent-resident` pays `demo-api-in` once through Kosha Pay, then prints the receipt and the HashScan link.
2. Run it against your own stack:
   - Core on port 4100, migrated, with `seed --profiles` run against `kosha_b`.
   - `demo-api-in` on 4101.
   - Confirm two token transfers on HashScan and one HCS message.
   - If something in Core is wrong, file an `[B→A]` issue; don't patch Core.
3. `docs(readme): first settled payment`: the transaction ID and links in the README.

---

## Phase 3: demo features (Gate 3)

### B13 · Demo agent
`b/13-demo-agent` · depends on: B12, and human step H4 (LLM key) · unblocks: none

1. `feat(pay): kosha_paid_fetch tool`: a LangChain tool, plus an Agent Kit plugin wrapper if `docs/research/agent-kit.md` found a plugin API.
2. `feat(demo-agent): research agent`
   - The Hedera Agent Kit toolkit plus `kosha_paid_fetch`, with the LLM chosen by `LLM_PROVIDER`.
   - Prompt from spec Step 9. Print each receipt.

### B14 · Console: live wiring
`b/14-console-live` · depends on: B11, **A13, A14** · unblocks: B19, B20

1. `feat(console): live data by default`: switch off mock mode and point at Core, with `seed --history` loaded.
2. `fix(console): align with Core responses`
   - Fix any mismatches on the Console side.
   - If a Core response breaks the A02 schema, file an `[B→A]` issue instead.
3. Verify that the feed and the counter update live while `pay-once` runs. Record what you saw in the PR.

### B15 · Console: tax screen and TDS download
`b/15-console-tax` · depends on: B10, **A15** · unblocks: B20

This is demo-critical widget 3.

1. `feat(console): tax screen`: quarter summary, deductee-wise totals, and rule-pack version and review status.
2. `feat(console): download TDS file`: through a route handler that streams Core's CSV.
3. `feat(console): CA filing view`: read only, with evidence links (HashScan, HCS sequence numbers).

### B16 · Console: agent-owner workspace
`b/16-console-agents` · depends on: B10, **A12** · unblocks: B22

1. `feat(console): agents list`: HCS-14 ID, credential, declared wallets, status.
2. `feat(console): spend`: by API and by day, with tax paid on top and budget remaining.
3. `feat(console): policy editor`: caps, allowlist, threshold action and accepted rule packs, saved through `PUT` policy.

### B17 · Burst and the `pnpm demo` runner
`b/17-demo-runner` · depends on: B12, **A12, A14** · unblocks: Gate 3

1. `feat(scripts): burst`: 20 quick calls, so the counter visibly moves.
2. `feat(scripts): demo runner`
   - `scripts/demo.ts` runs `seed --reset-demo`, then the spec's 7-step demo order, asserting each result.
   - Steps whose optional feature isn't merged print `SKIPPED (cut)` instead of failing.

### B18 · README and architecture
`b/18-readme` · depends on: B12 · unblocks: Gate 4

1. `docs(readme): overview and architecture`: what Kosha is, a Mermaid architecture diagram, the payment flow, and the sponsor mapping.
2. `docs(readme): setup and demo`
   - Setup (PROTOCOL §12 in user terms).
   - `pnpm demo`.
   - A table of HashScan links: a normal payment, a payment with TDS withheld, and the sweep.
   - "Rule pack unreviewed" and "not tax advice" labels.
3. `docs: architecture notes`: `docs/architecture.md` covering the components, trust boundaries and verifier checks.

### B19 · Deploy configuration for demo APIs and Console
`b/19-deploy-edges` · depends on: B14 · unblocks: H6

1. `chore(demo-api): Dockerfiles and Fly or Railway config` for both demo APIs.
2. `chore(console): Vercel config and env list`
3. `docs(readme): deploy steps`: the exact commands. The human runs them.

### B20 · Console end-to-end tests
`b/20-console-e2e` · depends on: B14, B15

Playwright on mock mode: the threshold counter crosses and turns amber, and the TDS CSV downloads with the right header row.

---

## Optional (built in reverse of the spec's cut list; skip them when told the team is behind)

### B21 · Gate: Hono adapter *(optional, cut 6)*
`b/21-gate-hono` · depends on: B05

`koshaHono()` plus tests.

### B22 · Console: tax credits and gains *(optional, cut 5)*
`b/22-console-credits` · depends on: B16, **A17**

TDS credited to the owner's PAN per deductor, and INR value and gain or loss per lot.

### B23 · HCS-14 identities for the demo agents *(optional, cut 4)*
`b/23-hcs14` · depends on: B12, **A07**

1. `feat(scripts): register-agents`: creates an HCS-14 identity for each demo agent, with a `kosha` profile field (credential issuer, credential hash, declared wallets; never the PAN).
2. `feat(pay): register()`: calls `POST /v1/agents` with the HCS-14 ID and credential.

### B24 · Console: outside payments *(optional, cut 3)*
`b/24-console-outside` · depends on: B10, **A19**

List, shortfall, and resolve or request a top-up. Add a step to `pnpm demo`: a plain transfer that appears within 30 seconds.

### B25 · Console: escrow and sweep co-sign *(optional, cut 2)*
`b/25-console-escrow` · depends on: B10, **A20**

- Show the escrow balance and the sweep schedule.
- A **Co-sign sweep** button signs through a server action using the demo compliance key, clearly labelled "demo signer". WalletConnect stays a stretch goal.

### B26 · Funding negotiation *(optional, cut 1)*
`b/26-negotiation` · depends on: B12, **A21**

1. Gate: `POST /.well-known/kosha/terms` accepts or counters a proposal and calls Core's `POST /v1/terms`.
2. Pay: reads the terms, proposes `payer` funding, stores the agreed term, and stamps it on every request.
3. Add the negotiation step to `pnpm demo`.
