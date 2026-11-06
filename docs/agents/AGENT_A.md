# Agent A queue: backend

You own the repo scaffold, `@kosha/shared`, `@kosha/hedera`, Kosha Core (`apps/core`) and the seed scripts. Work through this queue with the loop in [PROTOCOL.md §5](PROTOCOL.md#5-the-task-loop). The planned commits are a guide to size and order; split or merge them if the code calls for it, but keep each one small.

Each card reads: **branch** · **depends on** (a **bold** ID belongs to Agent B) · **unblocks**. "Spec" means [Kosha Execution Plan.md](../../Kosha%20Execution%20Plan.md).

---

## Phase 0 and 1: foundations

### A01 · Scaffold the monorepo
`a/01-scaffold` · depends on: none · unblocks: A02, A05, **B01, B03, B09** (Agent B is mostly idle until this merges, so keep it lean and open it early)

1. `chore(repo): pnpm workspace and turbo pipeline`
   - Root `package.json` with `packageManager` set to pnpm 10 and `engines.node >=24`.
   - `pnpm-workspace.yaml` covering `apps/*`, `packages/*` and `scripts`.
   - `turbo.json` with `build`, `dev`, `typecheck`, `lint` and `test` tasks.
   - `.nvmrc` containing `24`.
2. `chore(repo): shared tsconfig, lint and format`
   - `tsconfig.base.json`: strict, ES2023.
   - Lint and format setup as the `coding-standards` skill prescribes.
3. `chore(repo): package skeletons`
   - Create `package.json`, `tsconfig.json` and `src/index.ts` for each of: `@kosha/shared`, `@kosha/hedera`, `@kosha/tax-engine`, `@kosha/gate`, `@kosha/pay`, `@kosha/core`, `@kosha/demo-api-in`, `@kosha/demo-api-global`, `@kosha/demo-agent`, and `@kosha/scripts` (which uses `tsx`).
   - Internal packages export TypeScript source (PROTOCOL §2).
   - Do **not** create `apps/console`; B09 generates it.
4. `chore(repo): vitest and env loader`
   - One Vitest config per package.
   - `@kosha/shared` gets `loadEnv()`. It finds the repo root, reads `.env` and then `.env.local` (`.env.local` wins), and never logs values.
5. `chore(repo): root scripts and .env.example`
   - Root scripts `bootstrap`, `seed`, `register-agents`, `smoke-settle`, `pay-once`, `burst` and `demo`, each running `pnpm --filter @kosha/scripts exec tsx <name>.ts`.
   - `.env.example` lists every key from spec Step 2, plus `SETTLEMENT_TOKEN_ID`, `CORE_PORT`, `CORE_URL`, `CONSOLE_ADMIN_TOKEN`, `MAX_TX_FEE_HBAR`, `ISSUER_PRIVATE_KEY`, `PAN_COMMIT_SECRET`, `COMPLIANCE_ACCOUNT_ID`, `COMPLIANCE_PRIVATE_KEY`, `DEMO_API_IN_KEY`, `DEMO_API_GLOBAL_KEY`, `LLM_PROVIDER`, and an empty `# --- Agent B ---` section.
6. `ci: typecheck, lint and test on pull requests`: a GitHub Actions workflow using pnpm caching.

**Done when** a fresh clone passes `pnpm install && pnpm turbo run typecheck lint test`.

### A02 · Shared wire contracts
`a/02-contracts` · depends on: A01, **B00** · unblocks: A03, A05, **B04, B07, B10**

Read `docs/research/x402.md` first. Every request and response that crosses a package boundary becomes a Zod schema with an inferred type. Agent B builds against these, so get the names right and keep them stable.

1. `feat(shared): money, id and link helpers`
   - Convert micro-USDC and paise between `bigint` and decimal strings.
   - `formatUsdc` and `formatInr`.
   - Branded IDs.
   - `hashscanTx(txId)` and `hashscanTopic(topic, seq)`.
   - Tests.
2. `feat(shared): x402 headers and payment requirements`
   - `headers.ts` holds every header name.
   - `PaymentRequirements`, whose `extra.kosha` holds `quoteId`, `feePayer`, `memo`, `nodeAccountIds`, `expiresAt`, `transfers[]`, and `tax` (`rulepack`, `rateBps`, `inrValuePaise`, `tdsMicroUsdc`, `funding`, `reason`, `flags`).
   - `PaymentPayload` (the decoded payment header: the signed transaction as base64, plus `quoteId`).
   - `PaymentResponse`.
3. `feat(shared): facilitator API`
   - `QuoteRequest` (`method`, `resource`, `priceMicroUsdc`, optional `agentId`).
   - `VerifyRequest/Response` and `SettleRequest/Response` (`txId`, `hashscanUrl`, `hcsSequence | null`, `tdsMicroUsdc`).
   - An `ErrorCode` enum containing every verifier code in the spec, plus `quote_not_found`, `payer_not_declared`, `fee_too_high`, `wrong_nodes`, `unknown_receiver`, `policy_per_payment`, `policy_daily`, `policy_budget`, `policy_allowlist` and `policy_threshold_block`.
4. `feat(shared): registry schemas`
   - `ReceiverCreate`: it accepts a PAN that is never stored raw, and receiver `residency`.
   - `AgentRegister`.
   - `Credential` (issuer, subject, claims `residency`, `panOnFile` and `specifiedPerson`, and a signature).
   - `Policy` (spec Component 3 rules).
5. `feat(shared): console read API and fixtures`
   - Schemas: `LedgerQuery`, `LedgerRow` (including `sample: boolean`), `AggregateRow` (`thresholdPaise`, `pct`), the `StreamEvent` union (`payment.settled`, `tds.withheld`, `threshold.near`, `outside.payment`), `TdsExportRow`, `SweepRow`, `OutsidePaymentRow`, `PayerReportRow`.
   - `fixtures.ts`, with realistic examples for each schema and a test that parses every one. The Console runs on these fixtures until Core serves real data.
6. `docs(core): endpoint catalogue`: `docs/core-api.md` maps every spec endpoint, plus `/v1/stream` and `/v1/aggregates`, to its request and response schema names.

### A03 · Hedera client and quoted-transfer builder
`a/03-hedera-builder` · depends on: A02 · unblocks: A04, A08, **B08**

No network calls in this task.

1. `feat(hedera): client factory from env`: `buildClient()` handles testnet and mainnet and parses ED25519 and ECDSA keys.
2. `feat(hedera): build quoted transfer`
   - Signature: `buildQuotedTransfer(requirements, payerAccountId)`. Kosha Pay signs with exactly this function, so it must be the same thing the verifier checks.
   - Transaction ID from `feePayer`, node IDs from the quote, memo, token transfers (payer −total, each recipient +amount, as `Long`), `maxTransactionFee` set, then frozen.
3. `test(hedera): builder round trip`: build, sign with a generated key, then `toBytes` and `fromBytes`. Transfers, memo, fee payer and signature must survive.

### A04 · Transfer verifier
`a/04-verifier` · depends on: A03 · unblocks: A10

The verifier returns `{ ok: true, tx, payer } | { ok: false, code }`. Expiry and replay checks need the database, so they live in Core (A10).

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
3. `feat(hedera): verify payer signature`, given the payer's `PublicKey`.
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
   - unsigned
   - signed by the wrong key

### A05 · Core server skeleton
`a/05-core-skeleton` · depends on: A02 · unblocks: A06

1. `feat(core): fastify app factory`: `buildApp(deps)` (so tests can use `inject`), Zod type provider, pino logging, and an error handler that returns `{ error: ErrorCode }`.
2. `feat(core): typed config`: a Zod-validated env that fails fast and lists every missing key.
3. `feat(core): health and /v1/supported`: networks, asset, scheme, and the active rule-pack ID (read from `RULEPACK_PATH`).
4. `chore(core): dev script`: `pnpm --filter @kosha/core dev` runs `tsx watch` on `CORE_PORT`.

Tests: `inject` tests for health, supported, and a config error.

### A06 · Database schema
`a/06-db` · depends on: A05 · unblocks: A07

Money columns are `bigint` minor units. Later tables are added by the tasks that need them, each with its own migration.

1. `feat(core): profile tables`: `receivers` (with `residency`), `agents`, `policies`.
2. `feat(core): payment tables`: `quotes`, `payments`, `aggregates` (primary key `agent_id, receiver_id, fy`), `hcs_outbox`.
3. `chore(core): generate initial migration`: only the output of `drizzle-kit generate`.
4. `feat(core): db client and PGlite test harness`: `createDb(url)`, `testDb()` (PGlite with migrations applied), and a `db:migrate` script.

### A07 · Registry and test credential issuer
`a/07-registry` · depends on: A06 · unblocks: A09, A11, A18, **B23**

1. `feat(core): test credential issuer`: `issueCredential(claims)` and `verifyCredential()`, using Ed25519 over canonical JSON with `ISSUER_PRIVATE_KEY`.
2. `feat(core): auth hooks`: a receiver API key (stored hashed; Gate uses it) and `CONSOLE_ADMIN_TOKEN` (Console and scripts use it).
3. `feat(core): POST /v1/receivers`
   - Admin only.
   - Stores a salted PAN commitment (HMAC with `PAN_COMMIT_SECRET`) and never the raw PAN.
   - Accepts a caller-supplied API key (the seed uses this) or generates one and returns it once.
4. `feat(core): POST /v1/agents and GET /v1/agents/:id`
   - Verifies the credential and stores residency, PAN-on-file, specified-person and declared wallets.
   - An agent without a credential is `unknown`.

Tests use `inject` and PGlite.

### A08 · Mirror, HCS and schedule helpers
`a/08-hedera-io` · depends on: A03 · unblocks: A10, A19, A20

Use injectable `fetch` and SDK fakes in tests. Add one opt-in smoke test that runs only with `KOSHA_TESTNET=1`.

1. `feat(hedera): mirror client`: `accountKey(id)`, `transactionById(txId)`, and `tokenCreditsSince(account, token, cursor)` with pagination.
2. `feat(hedera): HCS submit`: `submitMessage(topic, json)` returns the sequence number and enforces a 1,024-byte size limit.
3. `feat(hedera): scheduled transfer helpers`: `createScheduledTransfer` (uses `setWaitForExpiry` only if `docs/research/scheduled-tx.md` says testnet supports it), `signSchedule` and `scheduleInfo`.

---

## Phase 2: first split payment (Gate 2)

### A09 · Quote service
`a/09-quote` · depends on: A07, **B02** · unblocks: A10

1. `feat(core): fx adapter`: an interface plus the `demo-fixed` source (`FX_DEMO_INR_PER_USD`), returning `inrPerUsdMicro` and a timestamp.
2. `feat(core): pair aggregate with open-quote reservation`
   - Financial year from `@kosha/tax-engine`.
   - The total is settled value, plus outside value, plus open quotes (PROTOCOL §2, design fix 1).
3. `feat(core): POST /v1/quote`
   - Receiver API key auth.
   - Load the agent (`unknown` if missing).
   - Run `decide()` and `applyFunding()`.
   - Persist the quote (`expiresAt` = now + 120 s, FX, node IDs).
   - Return the 402 body. For an unknown agent, the body explains how to register.
4. `test(core): quote scenarios`
   - under the threshold
   - crossing (`full`)
   - unknown payer at 20%
   - non-resident payer flag
   - foreign receiver flag
   - `price_inclusive` split
   - **two concurrent quotes just under the threshold both withhold**

### A10 · Verify, settle, ledger and HCS log
`a/10-settle` · depends on: A09, A04, A08, **B03** (bootstrap must have filled `kosha.env`) · unblocks: A11, A12, A13

1. `feat(core): POST /v1/verify`. In order:
   - decode the payload
   - load the quote
   - check expiry
   - check replay (the quote and the transaction ID are both unused)
   - fetch the payer key from the Mirror Node
   - run the verifier
   - check the payer is a declared wallet
2. `feat(core): settle and record`. Put the executor behind an interface so tests use a fake.
   - Mark the quote used **before** executing.
   - Sign as fee payer, execute, and get the receipt. On a receipt timeout, reconcile through the Mirror Node.
   - In **one database transaction**: insert the payment, add to the aggregate (row lock), and insert the outbox row.
3. `feat(core): HCS outbox publisher`
   - A loop with backoff publishes the spec's message to `HCS_PAYMENTS_TOPIC` and stores `hcs_seq`.
   - The message carries the HMAC pair ID only.
4. `feat(core): POST /v1/settle response`: `txId`, `hashscanUrl`, `hcsSequence` (`null` if still pending), `tdsMicroUsdc`.
5. `feat(scripts): smoke-settle`: `scripts/smoke-settle.ts` quotes for `agent-resident` against Core, signs with `buildQuotedTransfer`, then verifies and settles on testnet without Gate.

**Done when** smoke-settle prints a HashScan link that shows two token transfers, and the HCS message is on the topic. Put the link in the PR.

### A11 · Seed demo profiles
`a/11-seed-profiles` · depends on: A10 · unblocks: A14, **B12** (Gate 2 waits on this; open it as soon as it works)

`scripts/seed.ts --profiles` is idempotent and safe to run against any database (Agent B runs it against `kosha_b`).

1. `feat(scripts): seed receivers`
   - `receiver-in`: resident, threshold mode, payer funding, API key from `DEMO_API_IN_KEY`.
   - `receiver-global`: non-resident, API key from `DEMO_API_GLOBAL_KEY`.
2. `feat(scripts): seed agents`
   - `agent-resident` (PAN), `agent-specified` and `agent-nonresident`, each with a credential from the test issuer and wallets from env.
   - `agent-unknown` is deliberately left unregistered.

---

## Phase 3: demo features (Gate 3)

### A12 · Server-side spending policies
`a/12-policies` · depends on: A10 · unblocks: **B16, B17**

1. `feat(core): policy endpoints`: `GET` and `PUT /v1/agents/:id/policy` (admin).
2. `feat(core): enforce policy at quote`
   - Rules: per-payment, daily (by IST day), FY budget, allowlist (resource host), and threshold action (`block` returns `policy_threshold_block`).
   - Tax counts toward budgets.
   - Re-check the policy at verify.
3. `test(core): one test per rule`, plus "tax pushes the payment over the cap".

### A13 · Ledger, aggregates and live stream
`a/13-ledger-stream` · depends on: A10 · unblocks: A14, A15, **B14**

Auth: admin token or receiver API key. Responses must match the A02 schemas exactly, because the Console already renders their fixtures.

1. `feat(core): GET /v1/ledger`: filters `receiverId`, `agentId`, `from` and `to`, with cursor pagination, returning `LedgerRow`.
2. `feat(core): GET /v1/aggregates`: per pair, with threshold and percentage.
3. `feat(core): event bus`: settlement emits `payment.settled` and `tds.withheld`, and `threshold.near` once a pair reaches 90%.
4. `feat(core): GET /v1/stream`: SSE per receiver with a 15-second heartbeat.

### A14 · Sample history and threshold-demo seed
`a/14-seed-history` · depends on: A11, A13 · unblocks: A16, **B14, B17**

1. `feat(core): sample flag on payments`: a migration adding `sample boolean`, exposed on `LedgerRow`.
2. `feat(scripts): seed --history`: one quarter of realistic sample payments.
3. `feat(scripts): seed --reset-demo`
   - Sets the `agent-resident` ↔ `receiver-in` total to ₹9,980 (sample-labelled).
   - Clears the demo run's own payments, so `pnpm demo` can run again.

### A15 · Quarterly TDS export
`a/15-tds-export` · depends on: A13 · unblocks: **B15**

1. `feat(core): TDS export rows`
   - Quarter boundaries in IST.
   - Deductee-wise rows: masked deductee reference, amount paid, TDS, rate, payment and deduction dates, section `393(1)`, HCS sequence, transaction ID.
   - Document the chosen columns in `docs/core-api.md`.
2. `feat(core): GET /v1/exports/tds`: a CSV stream with `Content-Disposition`.
3. `test(core): golden CSV`

### A16 · Deploy configuration for Core
`a/16-deploy-core` · depends on: A14 · unblocks: H6

1. `chore(core): Dockerfile`: multi-stage, `pnpm deploy --filter @kosha/core`, runs migrations on boot.
2. `chore(core): Fly or Railway config`: health check, plus CORS for the Console origin.
3. `docs(core): deploy steps`: the exact commands and secrets list in `docs/core-api.md`. The human runs the deploy.

---

## Optional (built in reverse of the spec's cut list; skip them when told the team is behind)

### A17 · Payer gains report *(optional, cut 5)*
`a/17-gains` · depends on: A13 · unblocks: **B22**

- Add a `lots` table and migration.
- At settlement, spend lots first-in first-out and compute the gain in paise.
- Add `GET /v1/payers/:id/report`. The seed adds lots for the demo agents.

### A18 · Verify credentials against HCS-14 profiles *(optional, cut 4)*
`a/18-hcs14-check` · depends on: A07, **B00** · unblocks: nothing (pairs with B23)

When `POST /v1/agents` carries an HCS-14 ID:

- Resolve the profile with the standards SDK (see `docs/research/hcs14.md`).
- Require `profile.kosha.credentialHash` to equal the hash of the submitted credential.
- Require the declared wallets to match.

### A19 · Outside-payment watcher *(optional, cut 3)*
`a/19-watcher` · depends on: A13, A08 · unblocks: **B24**

1. Add the `outside_payments` table, migration and per-wallet cursor.
2. Every 30 seconds, a `node-cron` job looks for credits to a receiver wallet whose memo is not `kosha:*` and whose sender is a declared payer wallet. For each one:
   - add it to the pair's aggregate (outside value)
   - record any shortfall
   - emit `outside.payment`
3. `GET /v1/outside-payments` and `POST /v1/outside-payments/:id/resolve`.

### A20 · Escrow sweep with a scheduled transaction *(optional, cut 2)*
`a/20-sweep` · depends on: A13, A08 · unblocks: **B25**

1. Add the `sweeps` table, `POST /v1/sweeps` (admin, creates the month's scheduled transfer from escrow) and `GET /v1/sweeps`.
2. Run a monthly cron before the 7th.
3. Add `POST /v1/sweeps/:id/cosign`, which accepts signed `ScheduleSignTransaction` bytes.
4. Add `scripts/cosign-sweep.ts`, which signs with `COMPLIANCE_PRIVATE_KEY`.
5. Refresh status from the schedule info.

### A21 · Funding terms store *(optional, cut 1)*
`a/21-terms` · depends on: A13 · unblocks: **B26**

- Add a `terms` table (pair → funding) and migration.
- Add `POST /v1/terms` (receiver API key; Gate calls it when it accepts a proposal).
- The quote stamps the agreed funding mode instead of the receiver's default.

### A22 · Webhooks *(optional, stretch)*
`a/22-webhooks` · depends on: A13

- `POST /v1/webhooks` subscribes a URL to events.
- Deliveries are HMAC-signed, with retries.
