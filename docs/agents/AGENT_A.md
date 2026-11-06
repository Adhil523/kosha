# Agent A queue: backend

You own the repo scaffold, `@kosha/shared`, `@kosha/hedera`, Kosha Core (`apps/core`) and the seed scripts. Work through this queue with the loop in [PROTOCOL.md §5](PROTOCOL.md#5-the-task-loop). The planned commits are a guide to size and order; split or merge them if the code calls for it, but keep each one small.

Each card reads: **branch** · **depends on** (a **bold** ID belongs to Agent B) · **unblocks**. "Spec" means [Kosha Execution Plan.md](../../Kosha%20Execution%20Plan.md) (v2). "Findings" means [kosha-findings-and-design-updates.md](kosha-findings-and-design-updates.md).

**Plan v2 in one paragraph:**
- **Tax model:**
  - The threshold comes from the receiver (the buyer).
  - The TDS goes to the agent's own 2-of-2 reserve (mode C), and price-inclusive is gone.
  - Unverified payers follow the receiver's `strict` or `threshold_tolerant` policy.
  - Level 0 agents are registered on their first quote.
- **Wire format:**
  - Quotes are x402 v2 with two `accepts[]` entries, `kosha-split` and `exact` (compatibility).
  - Every HCS record is recomputable (running total and rule-pack hash).
- **Stack:** use `@hiero-ledger/sdk`, never `@hashgraph/sdk`, and pin `zod` at exactly `4.6.7`.

---

## Phase 0 and 1: foundations

### A01 · Scaffold the monorepo
`a/01-scaffold` · **done** (#2). It shipped the workspace, `@kosha/shared` (with `loadEnv`), `@kosha/scripts`, CI and `.env.example`. It deliberately created no skeletons for other packages: each owner creates its own (PROTOCOL §4).

### A02 · Shared wire contracts
`a/02-contracts` · depends on: A01, **B00** · unblocks: A03, A05, **B04, B07, B10**

Read `docs/research/x402.md` and spec Component 1 first. Every request and response that crosses a package boundary becomes a Zod schema (Zod `4.6.7`, pinned exactly) with an inferred type. Agent B builds against these, so get the names right and keep them stable. Reuse `@x402/core`'s types where they exist and mirror them in Zod.
1. `chore(repo): plan v2 env keys`
   - `.env.example`: drop `ESCROW_ACCOUNT_ID`; add `COMPAT_SETTLEMENT_ACCOUNT_ID`, `POOL_RESERVE_ACCOUNT_ID` and `HCS_AUDIT_TOPIC`.
   - If the human has confirmed **H0b** (Node 24.22.1 or later), set `engines.node` to `>=24.22.1`. Otherwise leave it and say so in the PR.
2. `feat(shared): money, id and link helpers`
   - Convert micro-USDC and paise between `bigint` and decimal strings.
   - `formatUsdc` and `formatInr`.
   - Branded IDs.
   - `hashscanTx(txId)` and `hashscanTopic(topic, seq)`.
   - Tests.
3. `feat(shared): x402 v2 headers and payment requirements`
   - `headers.ts`:
     - `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE` and `PAYMENT-RESPONSE`, plus the legacy `X-PAYMENT` as read-only.
     - `X-KOSHA-AGENT` and `X-KOSHA-TAX`.
     - Scheme names `kosha-split` and `exact`; network `hedera:testnet`.
   - `PaymentRequired`: `x402Version: 2`, `resource {url, description?, mimeType?}`, `accepts[]`, `error?`.
   - `PaymentRequirements`, with `extra.feePayer` and `extra.kosha`:
     - `quoteId`, `memo`, `expiresAt`.
     - `nodeAccountIds` (three of them) and `totalMicro`.
     - `transfers[]`, each `{account, amount, leg: 'consideration' | 'tds_reserve'}`.
     - `tax`: `rulepack`, `rateBps`, `inrValuePaise`, `tdsMicroUsdc`, `funding: 'payer_reserve'`, `reason`, `flags`.
     - An optional `register` link, and `mode: 'compat'` on the `exact` entry.
   - `PaymentPayload`: `{ x402Version, resource?, accepted, payload: { transaction } }`.
   - `SettlementResponse`, with Kosha's data in `extensions.kosha`: `hashscanUrl`, `hcsSequence`, `tdsMicroUsdc`.
4. `feat(shared): facilitator API`
   - `QuoteRequest`: `method`, `resource`, `priceMicroUsdc` (the net price), and optionally the `agent` identity string.
   - v2 `VerifyRequest/Response` and `SettleRequest/Response` (shapes in `docs/research/x402.md`).
   - `DecideRequest/Response` and `DecisionConfirm`.
   - An `ErrorCode` enum:
     - Every verifier code in the spec.
     - `quote_not_found`, `payer_not_declared`, `reserve_not_payers`, `fee_too_high`, `wrong_nodes`, `unknown_receiver`.
     - `policy_per_payment`, `policy_daily`, `policy_budget`, `policy_allowlist`, `policy_threshold_block`.
     - A map to the standard x402 `invalidReason` codes where one fits.
5. `feat(shared): registry schemas`
   - `ReceiverCreate`:
     - A PAN, never stored raw; `tan` and `gstin` optional.
     - `residency`, `specifiedPerson`, `mode`, `unverifiedPolicy`.
     - `wallets[]`, each with an ownership signature over a Core challenge.
   - `AgentRegister`: the identity (UAID, or CAIP-10 for Level 0), an optional credential, and wallets.
   - `Credential`: issuer, subject, claims (`residency`, `panOnFile`, `level`), and a signature. Specified-person status is **not** an agent claim.
   - `Policy` (spec Component 3 rules) and `Terms` (agreed verification level and accepted rule packs).
6. `feat(shared): console read API and fixtures`
   - Schemas:
     - `LedgerQuery`, `LedgerRow` (with `sample`, `reserveAccountId` and the legs).
     - `AggregateRow` (`thresholdPaise` from the receiver, `tolerancePaise`, `pct`).
     - The `StreamEvent` union: `payment.settled`, `tds.withheld`, `threshold.near`, `outside.payment`.
     - `TdsExportRow` (consideration, TDS, `fundedBy: 'deductee'`).
     - `MonthlyCloseRow`, `ChallanRow`, `ReleaseRow`.
     - `OutsidePaymentRow` (`classification`), `PayerReportRow`, and `AgentRow` (`level`, `reserveAccountId`).
   - `fixtures.ts`, with realistic examples for each schema and a test that parses every one. The Console runs on these fixtures until Core serves real data.
7. `docs(core): endpoint catalogue`: `docs/core-api.md` maps every spec endpoint, plus `/v1/stream` and `/v1/aggregates`, to its request and response schema names.

### A03 · Hedera client and quoted-transfer builder
`a/03-hedera-builder` · depends on: A02 · unblocks: A04, A08, **B08**

No network calls in this task. Create `@kosha/hedera` (PROTOCOL §4) on **`@hiero-ledger/sdk`**.

1. `feat(hedera): client factory from env`: `buildClient()` handles testnet and mainnet and parses ED25519 and ECDSA keys.
2. `feat(hedera): build quoted transfer`
   - Signature: `buildQuotedTransfer(requirements, payerAccountId)`. Kosha Pay signs with exactly this function, so it must be the same thing the verifier checks.
   - Transaction ID from `extra.feePayer`; node IDs from `extra.kosha.nodeAccountIds` (all three); memo; token transfers (payer −`totalMicro`, each leg +amount, as **`bigint`**); `maxTransactionFee` from `MAX_TX_FEE_HBAR`; then frozen.
3. `test(hedera): builder round trip`: build, sign with a generated key, then `toBytes` and `fromBytes`. Transfers, memo, fee payer, nodes and a signature on **every** node's body must survive.

### A04 · Transfer verifier
`a/04-verifier` · depends on: A03 · unblocks: A10

The verifier returns `{ ok: true, tx, payer } | { ok: false, code }`. Expiry, replay and looking up the payer's reserve need the database, so Core does those (A10) and passes the expected reserve account in.

1. `feat(hedera): verify transaction shape`. Check:
   - It is a `TransferTransaction`.
   - Fee payer.
   - Memo.
   - Node IDs equal the quote's.
   - Valid start is inside the quote window.
   - `maxTransactionFee` is at most the cap.
   - No HBAR, NFT or approved transfers.
2. `feat(hedera): verify token transfers against the quote`. Check:
   - Exactly one token, equal to the asset.
   - Exactly one debiting account (the payer).
   - The amounts map equals the quote's.
   - The `tds_reserve` leg credits the expected reserve account.
3. `feat(hedera): verify payer signature`, given the payer's `PublicKey`, on every node's body.
4. `test(hedera): tampered transaction fixtures`. Write one test per code:
   - extra transfer
   - wrong amount
   - wrong token
   - HBAR debit of Core
   - wrong memo
   - wrong fee payer
   - fee above the cap
   - wrong nodes
   - two debiting accounts
   - approved transfer
   - reserve leg to another account
   - signed for only some nodes
   - unsigned
   - signed by the wrong key

### A05 · Core server skeleton
`a/05-core-skeleton` · depends on: A02 · unblocks: A06

1. `feat(core): fastify app factory`: `buildApp(deps)` (so tests can use `inject`), Zod type provider, pino logging, and an error handler that returns `{ error: ErrorCode }`.
2. `feat(core): typed config`: a Zod-validated env that fails fast and lists every missing key.
3. `feat(core): health and /v1/supported`: v2 `kinds[]` (`kosha-split` and `exact` on `hedera:testnet`, each with `extra.feePayer`), `signers`, and the active rule-pack ID and hash (read from `RULEPACK_PATH`).
4. `chore(core): dev script`: `pnpm --filter @kosha/core dev` runs `tsx watch` on `CORE_PORT`.

Tests: `inject` tests for health, supported, and a config error.

### A06 · Database schema
`a/06-db` · depends on: A05 · unblocks: A07

Money columns are `bigint` minor units. Later tables are added by the tasks that need them, each with its own migration. Columns are listed in spec Component 1, "Data model".

1. `feat(core): profile tables`:
   - `receivers`: residency, specified person, mode, unverified policy, nullable TAN, and wallets with proof.
   - `agents`: level and reserve account.
   - `policies`.
2. `feat(core): payment tables`:
   - `quotes`: scheme, total and node IDs.
   - `payments`: reserve account and forwarding transaction ID.
   - `aggregates` (primary key `agent_id, receiver_id, fy`) and `hcs_outbox`.
3. `chore(core): generate initial migration`: only the output of `drizzle-kit generate`.
4. `feat(core): db client and PGlite test harness`: `createDb(url)`, `testDb()` (PGlite with migrations applied), and a `db:migrate` script.

### A07 · Registry and test credential issuer
`a/07-registry` · depends on: A06 · unblocks: A09, A11, A18, **B23**

1. `feat(core): test credential issuer`: `issueCredential(claims)` and `verifyCredential()`, using Ed25519 over canonical JSON with `ISSUER_PRIVATE_KEY`.
2. `feat(core): auth hooks`: a receiver API key (stored hashed; Gate uses it) and `CONSOLE_ADMIN_TOKEN` (Console and scripts use it).
3. `feat(core): POST /v1/receivers`
   - Admin only.
   - Stores a salted PAN commitment (HMAC with `PAN_COMMIT_SECRET`) and never the raw PAN.
   - Stores `specifiedPerson`, `residency`, `mode` and `unverifiedPolicy`. The default policy comes from the rule pack.
   - **Wallet ownership:** `GET /v1/receivers/challenge` returns a nonce. Each wallet must sign it, and Core checks the signature against the account key on the Mirror Node (findings §4.2 step 4).
   - Accepts a caller-supplied API key (the seed uses this) or generates one and returns it once.
4. `feat(core): POST /v1/agents and GET /v1/agents/:id`
   - Verifies a Level 1 or 2 credential and stores residency, PAN-on-file, level and declared wallets.
   - Accepts a `reserveAccountId` (the seed passes bootstrap's). Otherwise the reserve is created at the first quote (A09).

Tests use `inject` and PGlite.

### A08 · Mirror, HCS, schedule and reserve helpers
`a/08-hedera-io` · depends on: A03 · unblocks: A09, A10, A19, A20, **B28**

Use injectable `fetch` and SDK fakes in tests. Add one opt-in smoke test that runs only with `KOSHA_TESTNET=1`.

1. `feat(hedera): mirror client` at `@kosha/hedera/mirror`, using **fetch only and no SDK import**, so Gate can use it. It provides:
   - `accountKey(id)`.
   - `transactionById(txId)`, including token transfers (Gate's reserve proof).
   - `tokenCreditsSince(account, token, cursor)`, with pagination.
2. `feat(hedera): HCS submit`: `submitMessage(topic, json)` signs with the topic's submit key (Core), returns the sequence number, and enforces the 1,024-byte limit.
3. `feat(hedera): scheduled transfer helpers` (HIP-423 is live on testnet; see `docs/research/scheduled-transactions.md`):
   - `createScheduledTransfer`: `setWaitForExpiry(false)`, an expiry of at most 62 days, and it is idempotent, returning the existing ID on `IDENTICAL_SCHEDULE_ALREADY_CREATED`.
   - `signSchedule`.
   - `scheduleStatus` from the Mirror Node.
4. `feat(hedera): reserve account`: `createReserveAccount(agentPublicKey)` makes a `KeyList([agent, core], 2)` with `maxAutomaticTokenAssociations: 1`. The smoke test checks that the first credit's auto-association fee stays under `MAX_TX_FEE_HBAR`.

---

## Phase 2: first split payment (Gate 2)

### A09 · Quote service
`a/09-quote` · depends on: A07, A08, **B27** · unblocks: A10

1. `feat(core): fx adapter`: an interface plus the `demo-fixed` source (`FX_DEMO_INR_PER_USD`), returning `inrPerUsdMicro` and a timestamp.
2. `feat(core): pair aggregate with open-quote reservation`
   - Financial year from `@kosha/tax-engine`.
   - The total is settled value, plus outside value, plus open quotes (PROTOCOL §2, design fix 1).
3. `feat(core): resolve the payer`
   - From `X-KOSHA-AGENT`:
     - A registered UAID loads the agent.
     - An unknown CAIP-10 account is registered at **Level 0**, and its reserve is created through an injected `ReserveFactory` (A08).
     - No header means unidentified.
   - Make reserve creation run once per agent, even under concurrent quotes.
4. `feat(core): POST /v1/quote`
   - Receiver API key auth.
   - Run `decide()` with the receiver's profile, then `applyFunding()` (mode C), then compute the all-in total.
   - Persist the quote: `expiresAt` = now + 120 s, FX, three node IDs, and `scheme: kosha_split`.
   - Return the v2 `PaymentRequired` with the `kosha-split` entry. For an unverified payer, add the `register` link. The `exact` entry comes in A23.
5. `test(core): quote scenarios`
   - under the threshold
   - crossing (`full`)
   - a specified-person receiver uses ₹50,000
   - unverified payer: `strict` at 20%, and `threshold_tolerant` both within and over the tolerance
   - non-resident payer flag
   - foreign receiver flag
   - Level 0 auto-registration creates exactly one reserve
   - **two concurrent quotes just under the threshold both withhold**

### A10 · Verify, settle, ledger and HCS log
`a/10-settle` · depends on: A09, A04, A08, **B03** (bootstrap must have filled `kosha.env`) · unblocks: A11, A12, A13, A23, A24

1. `feat(core): POST /v1/verify` (v2 body). In order:
   - decode the payload
   - load the quote from `accepted.extra.kosha.quoteId`
   - check expiry
   - check replay (the quote and the transaction ID are both unused)
   - fetch the payer key from the Mirror Node
   - run the verifier with the payer's reserve account
   - check the payer is a declared wallet
2. `feat(core): settle and record`. Put the executor behind an interface so tests use a fake.
   - Mark the quote used **before** executing.
   - Sign as fee payer, execute, and get the receipt. On a receipt timeout, reconcile through the Mirror Node.
   - In **one database transaction**: insert the payment, add to the aggregate (row lock), and insert the outbox row.
3. `feat(core): HCS outbox publisher`
   - A loop with backoff publishes the spec's v2 `pay` message (with `agg` and `rph`) to `HCS_PAYMENTS_TOPIC` and stores `hcs_seq`.
   - On startup, if the active rule pack's hash has not been published, enqueue a `rulepack` message.
   - Messages carry the HMAC pair ID only.
4. `feat(core): POST /v1/settle response`: the v2 `SettlementResponse`, with `extensions.kosha` holding `hashscanUrl`, `hcsSequence` (`null` if still pending) and `tdsMicroUsdc`.
5. `feat(scripts): smoke-settle`: `scripts/smoke-settle.ts` quotes for `agent-resident` against Core, signs with `buildQuotedTransfer`, then verifies and settles on testnet without Gate.

**Done when** smoke-settle prints a HashScan link that shows two token transfers (the API and the agent's reserve), and the HCS message is on the topic. Put the link in the PR.

### A11 · Seed demo profiles
`a/11-seed-profiles` · depends on: A10 · unblocks: A14, **B12** (Gate 2 waits on this; open it as soon as it works)

`scripts/seed.ts --profiles` is idempotent and safe to run against any database (Agent B runs it against `kosha_b`). Account IDs, keys and reserve IDs come from the env keys that B03 writes.

1. `feat(scripts): seed receivers`, each with its wallet-ownership signature:
   - `receiver-in`: resident business, threshold mode, `threshold_tolerant`, API key from `DEMO_API_IN_KEY`.
   - `receiver-in-solo`: resident specified person (₹50,000 threshold), PAN only, no TAN.
   - `receiver-global`: non-resident, API key from `DEMO_API_GLOBAL_KEY`.
2. `feat(scripts): seed agents`
   - `agent-resident` (Level 1, PAN) and `agent-nonresident` (Level 1, Tax Residency Certificate), each with a test-issuer credential and its bootstrap reserve.
   - `agent-unknown` at **Level 0** with its bootstrap reserve. The demo upgrades it to Level 1 on stage.

---

## Phase 3: demo features (Gate 3)

### A12 · Server-side spending policies
`a/12-policies` · depends on: A10 · unblocks: **B16, B17**

1. `feat(core): policy endpoints`: `GET` and `PUT /v1/agents/:id/policy` (admin).
2. `feat(core): enforce policy at quote`
   - Rules: per-payment, daily (by IST day), FY budget, allowlist (resource host), and threshold action (`block` returns `policy_threshold_block` for `threshold_crossed` and `tolerance_exceeded`).
   - Tax counts toward budgets (the all-in total).
   - Re-check the policy at verify.
3. `test(core): one test per rule`, plus "tax pushes the payment over the cap".

### A13 · Ledger, aggregates and live stream
`a/13-ledger-stream` · depends on: A10 · unblocks: A14, A15, **B14**

Auth: admin token or receiver API key. Responses must match the A02 schemas exactly, because the Console already renders their fixtures.

1. `feat(core): GET /v1/ledger`: filters `receiverId`, `agentId`, `from` and `to`, with cursor pagination, returning `LedgerRow`.
2. `feat(core): GET /v1/aggregates`: per pair, with the receiver's threshold, the tolerance for unverified payers, and the percentage.
3. `feat(core): event bus`: settlement emits `payment.settled` and `tds.withheld`, and `threshold.near` once a pair reaches 90% of its threshold or tolerance. For a Level 0 payer, the event carries the Level 1 prompt.
4. `feat(core): GET /v1/stream`: SSE per receiver with a 15-second heartbeat.

### A14 · Sample history and threshold-demo seed
`a/14-seed-history` · depends on: A11, A13 · unblocks: A16, **B14, B17**

1. `feat(core): sample flag on payments`: a migration adding `sample boolean`, exposed on `LedgerRow`.
2. `feat(scripts): seed --history`: one quarter of realistic sample payments.
3. `feat(scripts): seed --reset-demo`
   - Sets `agent-resident` ↔ `receiver-in` to ₹9,980 and `agent-unknown` ↔ `receiver-in` to ₹4,980 (both sample-labelled).
   - Resets `agent-unknown` to Level 0.
   - Clears the demo run's own payments, so `pnpm demo` can run again.

### A15 · Quarterly TDS export
`a/15-tds-export` · depends on: A13 · unblocks: **B15**

1. `feat(core): TDS export rows`
   - Quarter boundaries in IST.
   - Deductee-wise rows:
     - Masked deductee reference.
     - Consideration (the price), TDS, rate, and "funded by the deductee (reserve)".
     - Payment and deduction dates, section `393(1)`.
     - HCS sequence and transaction ID.
   - Document the chosen columns in `docs/core-api.md`.
2. `feat(core): GET /v1/exports/tds`: a CSV stream with `Content-Disposition`.
3. `test(core): golden CSV`

### A23 · Compatibility mode for standard x402 clients
`a/23-compat` · depends on: A10 · unblocks: **B17** (demo step 6) · in the spec's cut list as item 4

Findings §5 asks for this during the hackathon. Any x402 v2 client can then pay a Kosha endpoint.

1. `feat(core): exact entry in quotes`
   - Add the second `accepts[]` entry: `scheme: exact`, `payTo: COMPAT_SETTLEMENT_ACCOUNT_ID`, `amount` = all-in total.
   - An unidentified caller is priced by the receiver's unverified-payer policy.
2. `feat(core): verify and settle exact payments`
   - Apply the official rules. Use `@x402/hedera`'s `exact` facilitator scheme if its API accepts Core's client; otherwise reimplement its checks.
   - Identify the payer from the transaction, and register it at Level 0 when it is new.
3. `feat(core): forwarder`
   - After settlement, an outbox-driven second transaction moves the price from the compat settlement account to the API and the TDS to `POOL_RESERVE_ACCOUNT_ID`, booked to the payer.
   - Store `forward_tx_id`; the HCS message carries `mode: compat`.
4. `test(core)`, plus `scripts/smoke-compat.ts` (opt-in), in which a stock `@x402/fetch` client pays.

### A24 · Standalone tax decisions: `POST /v1/decide`
`a/24-decide` · depends on: A10, **B27** · in the spec's cut list as item 5

1. `feat(core): POST /v1/decide`
   - Receiver API key auth.
   - Body: payer identity or claims, price and settlement chain.
   - Returns the decision, stores a `decisions` row, and logs an HCS `decision` message.
2. `feat(core): POST /v1/decisions/:id/confirm`: takes the chain and transaction reference, adds the value to the pair's aggregate, and logs it to HCS.
3. `docs(core): tax engine for other facilitators`: a section in `docs/core-api.md`.

### A16 · Deploy configuration for Core
`a/16-deploy-core` · depends on: A14 · unblocks: H6

1. `chore(core): Dockerfile`: multi-stage, `pnpm deploy --filter @kosha/core`, runs migrations on boot.
2. `chore(core): Fly or Railway config`: health check, plus CORS for the Console origin.
3. `docs(core): deploy steps`: the exact commands and secrets list in `docs/core-api.md`. The human runs the deploy.

---

## Optional (built in reverse of the spec's cut list; skip them when told the team is behind)

### A17 · Payer gains report *(optional, cut 7)*
`a/17-gains` · depends on: A13 · unblocks: **B22**

- Add a `lots` table and migration.
- At settlement, spend lots first-in first-out and compute the gain in paise.
- Add `GET /v1/payers/:id/report`. The seed adds lots for the demo agents.

### A18 · Verify credentials against HCS-14 profiles *(optional, cut 6)*
`a/18-hcs14-check` · depends on: A07, **B00** · unblocks: nothing (pairs with B23)

When `POST /v1/agents` carries a UAID (see `docs/research/hcs-14.md`):

- Parse it with `parseHcs14Did`, take `nativeId`, and fetch the HCS-11 profile with `fetchProfileByAccountId`.
- Require `profile.uaid` to equal the UAID, `profile.properties.kosha.credentialHash` to equal the hash of the submitted credential, and the declared wallets to match.
- Cache the profile in the `agents` row; never resolve it per request.

### A19 · Outside-payment watcher *(optional, cut 3)*
`a/19-watcher` · depends on: A13, A08 · unblocks: **B24**

1. Add the `outside_payments` table, migration and per-wallet cursor.
2. Every 30 seconds, a `node-cron` job looks for credits to a receiver wallet whose memo is not `kosha:*` and whose sender is a declared payer wallet. It **flags** each one and never withholds:
   - it counts toward the pair's aggregate until classified
   - record any shortfall
   - emit `outside.payment` and log an HCS `outside` message
3. `GET /v1/outside-payments` and `POST /v1/outside-payments/:id/classify` (`consideration`, or `not_consideration_gift` with a note). A gift leaves the threshold count and the export; the classification is logged to HCS.

### A20 · Monthly close and reserve release *(optional, cut 2)*
`a/20-release` · depends on: A13, A08 · unblocks: **B25**

1. Add the `challans` and `releases` tables. `GET /v1/close?receiverId=&month=` returns the payment summary: TDS per payer, TAN or PAN, and section.
2. `POST /v1/challans` records the challan reference. It stores only a hash, logs an HCS `challan` message, and creates one scheduled release per payer reserve: reserve → receiver, memo `kosha-release:<month>:<agent>`.
3. Add `POST /v1/releases/:id/cosign`, which accepts signed `ScheduleSignTransaction` bytes, and `scripts/cosign-release.ts`, which signs with the agent's key (demo).
4. Refresh the status from the Mirror Node, and run a cron on the 1st of the month that prepares the close.

### A21 · Verification terms store *(optional, cut 1)*
`a/21-terms` · depends on: A13 · unblocks: **B26**

- Add a `terms` table (pair → agreed verification level and accepted rule packs) and migration.
- Add `POST /v1/terms` (receiver API key; Gate calls it when it accepts a proposal).
- The quote stamps the agreed terms.

### A22 · Webhooks *(optional, stretch)*
`a/22-webhooks` · depends on: A13

- `POST /v1/webhooks` subscribes a URL to events.
- Deliveries are HMAC-signed, with retries.
