# Agent B queue: edges

You own research, the tax engine, the testnet bootstrap, Kosha Gate, Kosha Pay, the demo APIs, the demo agent, Kosha Console, the README and the demo scripts. You work in the `kosha-b` worktree. Work through this queue with the loop in [PROTOCOL.md §5](PROTOCOL.md#5-the-task-loop). The planned commits are a guide to size and order; split or merge them if the code calls for it, but keep each one small.

Each card reads: **branch** · **depends on** (a **bold** ID belongs to Agent A) · **unblocks**. "Spec" means [Kosha Execution Plan.md](../../Kosha%20Execution%20Plan.md) (v2). "Findings" means [kosha-findings-and-design-updates.md](kosha-findings-and-design-updates.md).

Agent A waits on three of your tasks: **B00** (before A02), **B27** (before A09 and A24) and **B03** (before A10). Open those PRs as soon as they are ready, and say so in the READY line.

**Plan v2 in one paragraph:**
- **Tax model:**
  - The threshold comes from the receiver (the API owner is the buyer and deductor).
  - The TDS goes to the agent's own 2-of-2 reserve (mode C), and price-inclusive is gone.
  - Unverified payers follow the receiver's `strict` or `threshold_tolerant` policy.
- **Wire format:** x402 v2 names (`PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`, `hedera:testnet`) and two `accepts[]` entries, `kosha-split` and `exact` (compatibility).
- **Stack:**
  - Use `@hiero-ledger/sdk` (never `@hashgraph/sdk`) and Agent Kit v4.
  - `kosha_paid_fetch` must be a `BaseTool`.
  - Pin `zod` at exactly `4.6.7`.
  - Create your own packages (PROTOCOL §4): subpath exports, no `index.ts`.

---

## Phase 0 and 1: foundations

### B00 · Research the moving parts
`b/00-research` · depends on: none · unblocks: **A02**, and informs A08, A18, B13, B23

Five one-page files in `docs/research/` (x402, Hedera USDC, scheduled transactions, HCS-14, Agent Kit). Each covers the answer, sources, exact versions, a current snippet, and **what it changes in the spec**. Plan v2 has already folded these into the spec, so finish the PR as written.

### B01 · Rule pack, loader and calendar helpers
`b/01-rulepack` · depends on: **A01** · unblocks: B02 · **merge as built** (PR #3). The v2 schema lands in B27; don't rework this PR.

The rule pack schema and `in-2026.1`, `loadRulePack()`, `rulepackMatches()`, the IST calendar (`financialYear`, `istDayKey`, `quarterOf`) and integer math.

### B02 · `decide()` and `applyFunding()`
`b/02-decide` · depends on: B01 · unblocks: B27 · **merge as built** (PR #5). The v2 changes land in B27.

### B27 · Tax engine v2
`b/27-tax-engine-v2` · depends on: B02 (stack on `b/02-decide` while it is open) · unblocks: **A09, A24** (Agent A's quote service waits on this)

Spec Component 1, "Rule pack" and "Tax engine core function". Findings §2 and §3.

1. `feat(tax-engine): rule pack v2 schema`
   - New fields:
     - `supersedes` and `taxBase: "price"`.
     - `thresholds` as `{ keyedTo: "buyer", specifiedBuyerPaise, otherBuyerPaise }`.
     - `unverifiedPayer: { defaultPolicy, toleranceLimitPaise }`.
     - `funding: "payer_reserve"`.
     - `nonResidentPayer` and `nonResidentReceiver`.
   - Ship `rulepacks/in-2026.2.json` and remove `in-2026.1.json`.
   - `rulePackHash()`: SHA-256 of the canonical JSON. Core publishes it to HCS.
2. `feat(tax-engine): decide() v2`
   - The receiver input carries `specifiedPerson`, `residency`, `mode` and `unverifiedPolicy`. The payer input loses `specifiedPerson`.
   - The threshold comes from the receiver. An unverified payer gets 0 under `strict`, and the lower of the legal threshold and the tolerance under `threshold_tolerant`.
   - New reasons: `within_tolerance`, `tolerance_exceeded` and `receiver_non_resident`.
3. `feat(tax-engine): applyFunding() mode C`: returns `{ receiverMicro, reserveMicro, payerTotalMicro }`. Remove `price_inclusive`.
4. `test(tax-engine): v2 cases`
   - Both buyer thresholds (specified-person and other receivers): under, at, over, `full` and `excess`.
   - Unverified payer under `strict`, and under `threshold_tolerant` within, at and over the tolerance.
   - Non-resident payer and receiver; first-rupee mode.
   - Keep the `fast-check` properties.

**Done when** there are at least 30 example tests plus the property tests, all green.

### B03 · Testnet bootstrap
`b/03-bootstrap` · depends on: **A01**, and human step H2 (operator account in `kosha.env`) · unblocks: **A10**

`scripts/bootstrap.ts` is idempotent: it skips anything whose ID is already in the env file. Run it for real before marking the PR ready. Use `@hiero-ledger/sdk` and `setDefaultMaxTransactionFee(new Hbar(30))` (token creation needs it). See `docs/research/hedera-usdc.md`.

1. `feat(scripts): env file updater`
   - In `scripts/lib/`, read and update keys in the file `.env` points to (follow the symlink).
   - Never print secrets.
2. `feat(scripts): settlement token`: if `SETTLEMENT_TOKEN_ID` is empty, create `tUSDC` (6 decimals, Core as treasury).
3. `feat(scripts): demo accounts`
   - Receivers: `receiver-in`, `receiver-in-solo` and `receiver-global`.
   - Agents: `agent-resident`, `agent-nonresident` and `agent-unknown`.
   - Kosha accounts: `compliance`, `compat-settlement` (Core's key) and `pool-reserve` (`KeyList([core, compliance], 2)`).
   - A **reserve per agent**: `KeyList([agent, core], 2)`.
   - Associate the token with every account; both keys sign for the 2-of-2 accounts. Treat `TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT` as success.
   - Fund the agents with the token and about 5 HBAR each (for the HCS-11 profile inscription).
   - Env keys (Agent A's seed reads exactly these names):
     - `RECEIVER_IN_ACCOUNT_ID` / `_PRIVATE_KEY`, and the same for `RECEIVER_IN_SOLO` and `RECEIVER_GLOBAL`.
     - `AGENT_RESIDENT_ACCOUNT_ID` / `_PRIVATE_KEY` / `_RESERVE_ID`, and the same for `AGENT_NONRESIDENT` and `AGENT_UNKNOWN`.
     - `COMPLIANCE_ACCOUNT_ID` / `_PRIVATE_KEY`, `COMPAT_SETTLEMENT_ACCOUNT_ID` and `POOL_RESERVE_ACCOUNT_ID`.
     - Add any new names under the `# --- Agent B ---` section of `.env.example`.
4. `feat(scripts): topics and secrets`
   - Create the payments, profiles and audit HCS topics, **each with `setSubmitKey(coreKey)`**.
   - Generate `DEMO_API_IN_KEY`, `DEMO_API_GLOBAL_KEY`, `ISSUER_PRIVATE_KEY`, `PAIR_HMAC_SECRET`, `PAN_COMMIT_SECRET` and `CONSOLE_ADMIN_TOKEN`.
5. `docs(scripts): testnet account table`: print the account table and write `docs/testnet-accounts.md` (IDs and HashScan links only, no keys).

### B04 · Gate: framework-agnostic handler
`b/04-gate-core` · depends on: **A02** · unblocks: B05

Create `@kosha/gate`. Spec Component 2.

1. `feat(gate): core client`: quote, verify and settle calls with the API key and timeouts, typed by `@kosha/shared`.
   - First, check whether `@x402/core`'s `x402ResourceServer` lets each request supply its own payment requirements. If it does, build on it with an `HTTPFacilitatorClient` pointing at Core. If not, use only its header codecs and types. Record the finding in the PR.
2. `feat(gate): route matching and pricing`: patterns like `GET /v1/gst-lookup` and `:param`, with **net** USDC price strings converted to micro-units.
3. `feat(gate): createGateHandler()`
   - Takes a generic request and returns either a response (`status`, `headers`, `body`) or "pass through" with `kosha` context.
   - Unpaid request: quote, then 402 with the `PAYMENT-REQUIRED` header (base64 JSON) and the same JSON as the body, with both `accepts[]` entries passed through.
   - Paid request (`PAYMENT-SIGNATURE`, or the legacy `X-PAYMENT`): verify, settle, then pass through with `PAYMENT-RESPONSE` and `X-KOSHA-TAX`.
   - Failure: 402 with a Kosha error code and `PAYMENT-RESPONSE` set to `success: false`.
   - CORS: expose `PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-KOSHA-TAX`; allow `PAYMENT-SIGNATURE, X-KOSHA-AGENT, Content-Type`.
4. `test(gate): handler against a fake Core`
   - 402 header and body shape
   - happy path
   - every verifier error code
   - replay
   - Core unreachable returns 503

### B05 · Gate: Express adapter and build
`b/05-gate-express` · depends on: B04 · unblocks: B06, B21, B28

1. `feat(gate): koshaGate() express middleware`: sets `req.kosha` and supports `settleMode` `before` (the default) or `after`.
2. `test(gate): supertest suite`
3. `chore(gate): tsup build`: ESM, CJS and type declarations, bundling `@kosha/shared`, with a usage snippet in the package README.

### B06 · Demo APIs
`b/06-demo-apis` · depends on: B05 · unblocks: B12

1. `feat(demo-api): Indian GST lookup API`
   - `apps/demo-api-in` on Express, with a mock dataset of about 10 companies.
   - `GET /v1/gst-lookup` costs 0.10 USDC and `GET /v1/company/:cin` costs 0.25 (net prices).
   - Uses `DEMO_API_IN_KEY`.
2. `feat(demo-api): foreign API`: `apps/demo-api-global` at 0.05 USDC, using `DEMO_API_GLOBAL_KEY`.
3. `feat(demo-api): /.well-known/kosha terms`: net prices, rule pack, the owner's unverified-payer policy, accepted verification levels, and the Level 1 registration link (static for now).

### B07 · Pay: policy engine
`b/07-pay-policy` · depends on: **A02**, B01 · unblocks: B08

Create `@kosha/pay`.

1. `feat(pay): policy schema and spend store`: an in-memory store keyed by IST day and financial year, behind an interface.
2. `feat(pay): checkPolicy()`
   - Rules:
     - Allowlist host, per-payment cap, daily cap, FY budget (all on the all-in total).
     - `onThreshold` (`warn`, `block` or `allow`) for `threshold_crossed` and `tolerance_exceeded`.
     - Accepted rule packs (`rulepackMatches`).
   - Tests for each rule.

### B08 · Pay: x402 v2 client and signing
`b/08-pay-fetch` · depends on: B07, **A03** · unblocks: B12

1. `feat(pay): createKoshaPay() config`: validated with Zod, including `reserveAccountId` and a `trustedFacilitators` list.
2. `feat(pay): kosha-split scheme client`: a scheme registered into `@x402/core`'s `x402Client`, which signs with `buildQuotedTransfer` from `@kosha/hedera`. Before signing it checks:
   - `amount` equals the `consideration` leg to `payTo`, and the legs sum to `totalMicro`.
   - The `tds_reserve` leg credits **this agent's own reserve**.
   - The asset matches; the fee payer (`extra.feePayer`) is trusted; the memo carries the quote ID; the nodes are listed.
3. `feat(pay): pay 402 responses`
   - `prepare(url)`: fetch; on a 402, decode `PAYMENT-REQUIRED`, pick the `kosha-split` entry, run the policy, and sign.
   - `complete(prepared)`: retry once with `PAYMENT-SIGNATURE` and `X-KOSHA-AGENT` (the UAID, or `hedera:testnet:<account>` at Level 0).
   - `fetch(url)` is both steps. Set `lastReceipt` from `PAYMENT-RESPONSE`.
4. `test(pay): mocked 402 flows`: happy path, policy block, single retry, tampered quote refused, reserve leg to another account refused.
5. `chore(pay): tsup build` that bundles the internal packages.

### B09 · Console: scaffold
`b/09-console-scaffold` · depends on: **A01** · unblocks: B10

1. `chore(console): generate Next.js app`: generated output only (latest stable, App Router, TypeScript, Tailwind v4), named `@kosha/console`.
2. `chore(console): add shadcn/ui`: init plus the generated components (button, card, table, badge, progress, tabs, dialog, tooltip, sonner).
3. `feat(console): workspace shell`
   - Layout and side navigation for the API owner, agent owner and CA workspaces.
   - Every route from spec Component 4 as an empty page. In v2 these are `/monthly` and `/reserve` instead of `/escrow`; add them in B11 if this PR is already open.
4. `feat(console): demo sign-in`
   - `DEMO_AUTH=1` shows a picker and stores a cookie session.
   - Footer labels: "sample data", "rule pack unreviewed", "not tax advice".
5. `feat(console): rule-pack badge`: "<pack> · unreviewed", from `/v1/supported` (falls back to a fixture).

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
   - A progress bar towards **the receiver's** threshold (₹10,000, or ₹50,000 for a specified person), with a tolerance marker for unverified payers, turning amber at 90%.
   - Once crossed, rows read "1% reserved" (or "20% reserved" for unverified payers).
   - Amounts show in USDC and ₹, with the FX rate in a tooltip.

### B11 · Console: overview and counterparties
`b/11-console-overview` · depends on: B10 · unblocks: B14

1. `feat(console): overview cards`: earnings today and this month, TDS reserved by payers this month, payments per minute.
2. `feat(console): counterparties`: per-payer progress bars against this receiver's threshold, a residency badge, and a verification-level badge (0, 1 or 2).

### B28 · Gate: on-chain reserve proof
`b/28-gate-reserve-proof` · depends on: B05, **A08** · unblocks: B12 (optional for it)

Findings §6.1 item 2. Spec Component 2, step 3.

1. `feat(gate): onChainProof`: after settle, read the transaction with `@kosha/hedera/mirror` and check the `tds_reserve` leg credited the quoted amount. Poll briefly for Mirror Node lag (a few seconds). On by default.
2. `test(gate): proof`: a matching transaction passes, a missing or short reserve leg fails, and lag times out cleanly.
3. `feat(scripts)`: `burst.ts` turns the proof off.

### B12 · First split payment, end to end (Gate 2)
`b/12-pay-once` · depends on: B06, B08, **A11** · unblocks: B13, B17, B18 · **This is Gate 2. Tell the human the moment it passes.**

1. `feat(scripts): pay-once`: `agent-resident` pays `demo-api-in` once through Kosha Pay, then prints the receipt and the HashScan link.
2. Run it against your own stack:
   - Core on port 4100, migrated, with `seed --profiles` run against `kosha_b`.
   - `demo-api-in` on 4101.
   - Confirm two token transfers on HashScan (the API and **the agent's reserve**) and one HCS message carrying `agg`.
   - If something in Core is wrong, file an `[B→A]` issue; don't patch Core.
3. `docs(readme): first settled payment`: the transaction ID and links in the README.

---

## Phase 3: demo features (Gate 3)

### B13 · Demo agent
`b/13-demo-agent` · depends on: B12, and human step H4 (LLM key) · unblocks: none

Spec Component 3, "Hedera Agent Kit plugin". `docs/research/agent-kit.md`. Use `@hashgraph/hedera-agent-kit` v4 (an optional peer dependency of `@kosha/pay`) and `@hashgraph/hedera-agent-kit-langchain`; never the deprecated `hedera-agent-kit`.

1. `feat(pay): Agent Kit plugin`
   - `KoshaPaidFetchTool extends BaseTool`: its `coreAction` is `pay.prepare(url)` and its `secondaryAction` is `pay.complete()`. It must be a `BaseTool`, or the kit skips policies and hooks.
   - `KoshaBudgetPolicy extends AbstractPolicy`, blocking at `shouldBlockPostCoreAction` on the quote's all-in total.
   - `koshaPayPlugin(pay)`. Match the kit's `BaseTool` signatures to the installed version.
2. `feat(demo-agent): research agent`
   - Plugins: `koshaPayPlugin(pay)` and `coreAccountQueryPlugin` only, with no mutation plugins.
   - `context.hooks`: the budget policy, plus `HcsAuditTrailHook` writing to `HCS_AUDIT_TOPIC`.
   - `createAgent` from `langchain` v1, with the LLM chosen by `LLM_PROVIDER` (default `claude-sonnet-5-5`). Smoke-test that `@langchain/anthropic` handles the model's adaptive thinking.
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

1. `feat(console): tax screen`: quarter summary, deductee-wise totals, and rule-pack version, review status and hash (linked to its HCS message).
2. `feat(console): download TDS file`: through a route handler that streams Core's CSV.
3. `feat(console): CA filing view`: read only, with evidence links (HashScan, HCS sequence numbers).

### B16 · Console: agent-owner workspace
`b/16-console-agents` · depends on: B10, **A12** · unblocks: B22

1. `feat(console): agents list`: UAID, verification level (with a "verify to drop to 1%" prompt at Level 0), credential, declared wallets, and the reserve account and its balance (Mirror Node).
2. `feat(console): spend`: by API and by day, with tax reserved on top and budget remaining.
3. `feat(console): policy editor`: caps, allowlist, threshold action and accepted rule packs, saved through `PUT` policy.

### B17 · Burst and the `pnpm demo` runner
`b/17-demo-runner` · depends on: B12, **A12, A14** (and **A23** for step 6) · unblocks: Gate 3

1. `feat(scripts): burst`: 20 quick calls, so the counter visibly moves.
2. `feat(scripts): demo runner`
   - `scripts/demo.ts` runs `seed --reset-demo`, then the spec's 8-step demo order, asserting each result.
   - Step 6 uses a stock `@x402/fetch` client against the `exact` entry.
   - Steps whose feature isn't merged or was cut print `SKIPPED (cut)` instead of failing.

### B18 · README and architecture
`b/18-readme` · depends on: B12 · unblocks: Gate 4

1. `docs(readme): overview and architecture`: what Kosha is, a Mermaid architecture diagram, the payment flow, the on-chain versus off-chain table (findings §6.1), and the sponsor mapping.
2. `docs(readme): setup and demo`
   - Setup (PROTOCOL §12 in user terms).
   - `pnpm demo`.
   - A table of HashScan links: a normal payment, a payment with TDS reserved, and the reserve release.
   - "Rule pack unreviewed" and "not tax advice" labels.
3. `docs(readme): why Hedera, network impact and business model`: from `docs/hackathon-readiness.md` §3–§6 (network impact, Lean Canvas, why Hedera, roadmap and GTM), plus a **Validation** section that summarises the human's feedback log.
4. `docs: architecture notes`: `docs/architecture.md` covering the components, trust boundaries and verifier checks.

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

### B21 · Gate: Hono adapter *(optional, cut 8)*
`b/21-gate-hono` · depends on: B05

`koshaHono()` plus tests.

### B22 · Console: tax credits and gains *(optional, cut 7)*
`b/22-console-credits` · depends on: B16, **A17**

TDS credited to the owner's PAN per deductor, and INR value and gain or loss per lot.

### B23 · HCS-14 identities for the demo agents *(optional, cut 6)*
`b/23-hcs14` · depends on: B12, **A07**

See `docs/research/hcs-14.md`.

1. `feat(scripts): register-agents`: for each Level 1 demo agent, `createUaid()` and an HCS-11 profile (`createAndInscribeProfile`) with `profile.uaid` set and `properties.kosha` holding the credential issuer, credential hash and declared wallets (never the PAN).
2. `feat(pay): register()`: calls `POST /v1/agents` with the UAID and the credential. The demo's Level 0 → Level 1 upgrade for `agent-unknown` uses it.

### B24 · Console: outside payments *(optional, cut 3)*
`b/24-console-outside` · depends on: B10, **A19**

List flagged transfers and any shortfall. Let the owner classify each one as consideration or "not consideration: gift from a relative" (with a note). Add a step to `pnpm demo`: a plain transfer that is flagged within 30 seconds and marked as a gift.

### B25 · Console: monthly tax and reserve release *(optional, cut 2)*
`b/25-console-monthly` · depends on: B10, **A20**

- API owner `/monthly`: the payment summary, **Record challan reference** (mock, clearly labelled), and the release status per payer.
- Agent owner `/reserve`: the reserve balance and a **Co-sign release** button that signs through a server action with the agent's demo key, labelled "demo signer". HashPack via WalletConnect is a stretch goal that raises the Integration score.

### B26 · Verification terms negotiation *(optional, cut 1)*
`b/26-negotiation` · depends on: B12, **A21**

1. Gate: `POST /.well-known/kosha/terms` accepts or counters a proposal (for example "strict policy: Level 0 pays 20%; present Level 1 for 1%") and calls Core's `POST /v1/terms`.
2. Pay: reads the terms, proposes its verification level and accepted rule packs, stores the agreed terms, and stamps them on every request.
3. Add the negotiation step to `pnpm demo`.
