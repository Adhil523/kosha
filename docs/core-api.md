# Kosha Core API

Every endpoint Core serves, with the Zod schema for its request and response. Schemas live in `@kosha/shared` and are imported by subpath, for example `import { quoteRequestSchema } from '@kosha/shared/facilitator-api'`. Money is always an integer minor-unit string on the wire (`Amount`) and `bigint` in code.

Auth: both secrets are sent the same way, as `Authorization: Bearer <secret>`. A missing or wrong secret returns `401` with `{ error: "unauthorized" }`.
- **receiver**: the receiver's API key, sent by Gate.
- **admin**: `CONSOLE_ADMIN_TOKEN`, used by the Console and scripts.
- **public**: no auth.

Errors are `errorResponseSchema` (`{ error: ErrorCode }`, from `error-codes`). The facilitator endpoints use x402 v2 shapes instead:
- **verify** fails with `isValid: false`, the standard x402 reason in `invalidReason` (`toX402Reason`), and the Kosha code in `extra.kosha.errorCode`.
- **settle** fails with `success: false` and the Kosha code itself in `errorReason` (for example `"replay"`), because `extensions.kosha` carries settlement data only. `errorMessage` holds a human-readable explanation.

## Facilitator (x402 v2)

| Method and path | Auth | Request | Response | Task |
| --- | --- | --- | --- | --- |
| `GET /v1/supported` | public | — | `facilitator-api` `supportedResponseSchema` | A05 |
| `POST /v1/quote` | receiver | `facilitator-api` `quoteRequestSchema` | `facilitator-api` `quoteResponseSchema` (= `x402-payment` `paymentRequiredSchema`) | A09, A23 |
| `POST /v1/verify` | receiver | `facilitator-api` `facilitatorRequestSchema` | `facilitator-api` `verifyResponseSchema` | A10 |
| `POST /v1/settle` | receiver | `facilitator-api` `facilitatorRequestSchema` | `facilitator-api` `settleResponseSchema` (= `x402-payment` `settlementResponseSchema`) | A10 |
| `POST /v1/decide` | receiver | `facilitator-api` `decideRequestSchema` | `facilitator-api` `decideResponseSchema`; see below | A24 |
| `POST /v1/decisions/:id/confirm` | receiver | `facilitator-api` `decisionConfirmSchema` | `facilitator-api` `decideResponseSchema` | A24 |

The quote's `kosha-split` entry must pass `split-quote` `checkSplitQuote()`; Kosha Pay runs the same check before signing.

Besides the transaction checks, verify and settle refuse a payment when:
- the echoed `accepted` entry's `amount`, `payTo` or `asset` differs from what Core issued for that quote (`amount_mismatch`). Gate prices the route from `accepted.amount`, so this stops a quote for a cheaper route paying for a dearer one.
- the transaction is past its valid duration, or its valid start is still in the future (`valid_start_out_of_window`). This is checked before the quote is claimed, so the payer can sign again.
- the payer's balance of the settlement token, read from the Mirror Node, is below the debit, or the payer isn't associated with the token (`insufficient_funds`; x402 reason `invalid_exact_hedera_payload_preflight_failed`). Core pays the network fee even for a failed transfer.

**Quoted price.** A valid verify carries `extra.kosha.priceMicroUsdc`, and a successful settle carries `extensions.kosha.priceMicroUsdc`: the API price of the quote this payment paid. Gate serves only a route priced at exactly that. Otherwise a quote made for a cheaper route could serve a dearer one. That covers an `exact` entry whose all-in total covers the dearer price, and a resent payment's earlier result.

**Retried settle.** A settle sent again with the same signed transaction, for example after Gate timed out while the transfer landed, gets the earlier result instead of `replay`. That is the same success body, or `settlement_pending` or `settlement_failed`. The payer's signature is checked again, because transaction IDs are public. Any other transaction on a used quote is still `replay`. A resent success is not announced on the live stream a second time.

Clients reading a 402 that may also offer entries Kosha doesn't model (another network, or a scheme like `upto`) should parse it with `x402-payment` `offeredPaymentRequiredSchema`. That schema drops those entries instead of failing.

### Compatibility mode (A23)

Any x402 v2 client can pay a Kosha endpoint through the plain `exact` entry. Kosha Pay keeps the atomic `kosha-split` path.

**Quote.** `POST /v1/quote` with an agent returns two entries sharing one `quoteId`: `kosha-split` first, then `exact`. Without an agent it returns the `exact` entry alone; it used to answer `400`. The `exact` entry is:
- `payTo`: `COMPAT_SETTLEMENT_ACCOUNT_ID` (Core's key);
- `amount`: the all-in total, price plus TDS;
- `extra`: `{ feePayer, kosha: { quoteId, mode: "compat" } }`.

**Pricing a caller with no agent.** Core can't see this payer's year total until the transaction names it, so it never assumes the payer is still inside a tolerance:
- `threshold_tolerant` receiver: the tolerance counts as used, and the payment pays the no-PAN rate (`tolerance_exceeded`, 20%);
- `strict` receiver: 20% from the first rupee;
- foreign receiver: no TDS.

This can over-deduct, which is a refundable credit in the pooled reserve, but it never under-deducts. A caller that sends `X-KOSHA-AGENT` is priced exactly, against its pair's total.

**Verify** (`@kosha/hedera/exact-verifier`, the official `exact` rules):
- any memo and any nodes;
- Core is the fee payer and moves no tokens itself (`fee_payer_transferring`);
- the fee cap and the valid-start window as for `kosha-split`;
- exactly one debiting account, and the only credit is `amount` to `payTo`.

The quote ID comes from `accepted.extra.kosha.quoteId`; a payload without one is `quote_not_found`. On a quote made for an agent, the payer must be one of its wallets. A `kosha-split` payment on a quote that offered only `exact` is `unsupported_scheme`.

**Settle.**
- The payment is booked to the quote's agent, else to the agent that declared the paying account, else to a new Level 0 agent for that account. That agent gets no reserve: its TDS is pooled.
- The quote becomes `scheme: exact_compat`, with `POOL_RESERVE_ACCOUNT_ID` as its reserve.
- The HCS `pay` message carries `mode: "compat"`, and the settlement response's `amount` is the all-in total.

**Forward.** A loop in Core runs every few seconds with backoff. For each settled compat payment not yet forwarded, it sends a second transaction, memo `kosha-fwd:<quoteId>`: settlement account → API wallet (the price) and → pooled reserve (the TDS). Core is the fee payer, and its signature also covers the settlement account.
- The transaction ID is stored in `forwardTransactionID` before it executes, and `forwardedAt` is set once it is confirmed.
- An attempt that timed out is resolved through the Mirror Node, never resubmitted. A refused attempt, or one still unseen after 4 minutes, is replaced by a new transaction.

**Smoke test (opt-in, testnet):** `pnpm smoke-compat [url]` pays demo-api-in with stock `@x402/fetch` and `@x402/hedera`. Stock clients pay only default assets (Circle USDC), so the script allows `SETTLEMENT_TOKEN_ID` through `spendControls.allowedAssets` for development on tUSDC.

### Tax engine for other facilitators (A24)

A facilitator that settles on its own rail (another chain, or its own Hedera flow) can use Kosha for the tax decision and the audit trail alone. Core never sees or signs that payment. Both calls use the receiver's API key, like `/v1/quote`.

**1. `POST /v1/decide`** before the payment. The body is `decideRequestSchema`:
- `payer`: either
  - `{ identity }`, a Kosha agent's UAID or CAIP-10 account. An unknown CAIP-10 account is registered at Level 0 and an unknown UAID is `400 payer_not_declared`. Its pair total is the one quotes use, so decisions and Kosha payments add up together.
  - `{ claims: { residency, panOnFile }, reference }`, for a payer the facilitator profiles itself. Its pair is tracked by `(receiver, reference)` on the decisions alone and never becomes a Kosha agent.
- `priceMicroUsdc`: the API's net price.
- `chain`: where the payment will settle, e.g. `eip155:8453`.
- `inrPerUsdMicro` (optional): the facilitator's own FX rate. Core uses its own when it is left out.
- `resource` (optional).

The answer is `decideResponseSchema`: the rule pack, rate, INR value, TDS in paise and micro-USDC, reason, flags, and the decision ID. The facilitator withholds `tdsMicroUsdc` on its rail. Core queues an HCS `decision` message (`did`, `chain`, price, TDS, rate, HMAC pair ID, FY, and `agg` including this payment); `hcsSequence` is `null` until the outbox publishes it.

An unconfirmed decision is held against the pair for 15 minutes, as an open quote is, so two decisions near the threshold can't both skip TDS.

**2. `POST /v1/decisions/:id/confirm`** once the payment settles. The body is `{ chain, transactionRef }`.
- The decision's value is added to the pair's total for good, and an HCS `decision_confirmed` message (`did`, `chain`, `ref`) ties the log to that transaction.
- Confirming again with the same reference returns the same decision; another reference is `409`.
- The wrong chain is `400`, and another receiver's decision is `404`.
- A decision confirmed after its 15 minutes still counts: the payment happened.

## Registry

| Method and path | Auth | Request | Response | Task |
| --- | --- | --- | --- | --- |
| `GET /v1/receivers/challenge` | admin | — | `registry` `receiverChallengeSchema` | A07 |
| `POST /v1/receivers` | admin | `registry` `receiverCreateSchema` | `registry` `receiverCreatedSchema`; `409` if a wallet is already registered | A07 |
| `POST /v1/agents` | admin | `registry` `agentRegisterSchema` | `registry` `agentRowSchema` | A07 |
| `GET /v1/agents` | admin | — | array of `registry` `agentRowSchema`, oldest first; `[]` when none | #47 |
| `GET /v1/agents/:id` | admin | — | `registry` `agentRowSchema` | A07 |
| `GET /v1/agents/challenge` | public | — | `registry` `agentChallengeSchema` | #56 |
| `POST /v1/agents/self` | account proof | `registry` `agentSelfRegisterSchema` | `registry` `agentRowSchema`; `201` new, `200` updated | #56 |
| `GET` / `PUT /v1/agents/:id/policy` | admin | `registry` `policySchema` | `registry` `policySchema` | A12 |
| `POST /v1/terms` | receiver | `registry` `termsProposalSchema` | `registry` `termsAnswerSchema` | A21 (optional) |

### Agent identity and self-registration (#56)

**One record per account.** An agent keeps a single record as its identity moves from its CAIP-10 account (`hedera:testnet:0.0.6003`, Level 0) to an HCS-14 UAID whose `nativeId` is that same account. Its ID, reserve, payments and aggregates all stay with it.
- Registering the UAID (`POST /v1/agents` or `/v1/agents/self`) upgrades the existing record in place and answers `200`.
- Registering the CAIP-10 identity again keeps the UAID; the identity never moves back.
- Everywhere Core looks an agent up by identity (`X-KOSHA-AGENT` at quote, the demo admin endpoints), the old CAIP-10 identity still finds the upgraded agent.
- A wallet held by an agent whose identity is backed by a different account is still a clash (`400`).

**Self-registration.** `POST /v1/agents/self` needs no token, so an agent never holds `CONSOLE_ADMIN_TOKEN`:
1. The agent gets a nonce from `GET /v1/agents/challenge`. It is single-use and valid for 10 minutes.
2. It signs the nonce with the key of its identity's account (the CAIP-10 account, or the UAID's `nativeId`), and sends the signature in hex with the same body as `POST /v1/agents`.
3. Core checks the signature against that account's key on the Mirror Node.

The agent may declare only that account as a wallet, and `reserveAccountId` is ignored, because Core creates the 2-of-2 reserve itself. A credential and the HCS-11 profile check work exactly as on the admin route. Responses:
- a wrong key: `401`;
- a reused or expired challenge, or another wallet: `400`.

### Spending policies (A12)

`GET` returns `404 not_found` until a policy is set. `PUT` replaces every rule and returns `404` for an unknown agent. An agent with no policy has no caps.

Core applies the policy at `POST /v1/quote` and again at verify (and so at settle). The rules and codes match Kosha Pay's `checkPolicy` and run in the same order:

1. `policy_allowlist`: the resource's host must be on `allowlist`. `*.example.com` matches any subdomain. An empty allowlist leaves hosts unrestricted.
2. `policy_per_payment`: the all-in total (price plus TDS) is at most `perPaymentMicro`.
3. `policy_daily`: what the agent has committed since midnight IST, plus this total, is at most `dailyMicro`.
4. `policy_budget`: the same for the financial year against `fyBudgetMicro`.
5. `policy_threshold_block`: when `thresholdAction` is `block` and the quote's reason is `threshold_crossed` or `tolerance_exceeded`. `warn` logs and quotes; `allow` quotes.

"Committed" counts settled and in-flight payments plus the agent's open quotes, so two concurrent quotes can't both fit under one cap. A quote takes a per-agent lock while it checks. `acceptRulepacks` is stored for Pay; Core does not enforce it.

A refused quote returns `403` with `{ error: "policy_…", message }` and stores nothing. At verify, the code goes in `extra.kosha.errorCode`; at settle, in `errorReason`.

## Console reads

| Method and path | Auth | Request | Response | Task |
| --- | --- | --- | --- | --- |
| `GET /v1/ledger` | admin or receiver | `console-api` `ledgerQuerySchema` (query string) | `console-api` `ledgerPageSchema` | A13 |
| `GET /v1/aggregates?receiverId=` | admin or receiver | — | array of `console-api` `aggregateRowSchema` | A13 |
| `GET /v1/stream?receiverId=` | admin or receiver | — | SSE, each `data:` is `console-api` `streamEventSchema` | A13 |
| `GET /v1/exports/tds?receiverId=&quarter=` | admin or receiver | `tax-reports` `quarterSchema` | CSV; one row per `tax-reports` `tdsExportRowSchema`, header = its keys | A15 |
| `GET /v1/outside-payments?receiverId=` | admin or receiver | — | array of `console-api` `outsidePaymentRowSchema`, newest first | A19 (optional) |
| `POST /v1/outside-payments/:id/classify` | admin or receiver | `tax-reports` `outsideClassifySchema` | `console-api` `outsidePaymentRowSchema`; `409` once classified | A19 (optional) |
| `GET /v1/close?receiverId=&month=` | admin or receiver | `tax-reports` `monthSchema` | `tax-reports` `monthlyCloseSchema` | A20 (optional) |
| `GET /v1/challans?receiverId=` | admin or receiver | — | array of `tax-reports` `challanRowSchema`, newest month first | A20 (optional) |
| `POST /v1/challans` | admin or receiver | `tax-reports` `challanRecordSchema` | `201` `{ challan: challanRowSchema, releases: releaseRowSchema[] }`; `409` once the month is closed | A20 (optional) |
| `GET /v1/releases?challanId=&receiverId=` | admin or receiver | — | array of `tax-reports` `releaseRowSchema` | A20 (optional) |
| `POST /v1/releases/:id/cosign` | admin or receiver | `tax-reports` `releaseCosignSchema` (a signed `ScheduleSignTransaction`, base64) | `tax-reports` `releaseRowSchema` | A20 (optional) |
| `GET /v1/payers/:id/report` | admin | — | array of `tax-reports` `payerReportRowSchema` | A17 (optional) |

### Ledger, aggregates and stream (A13)

**Scope.** The admin token reads any receiver (and may leave `receiverId` out of the ledger and aggregates). A receiver key reads only its own rows; naming another receiver returns `403`.

**`/v1/ledger`** lists settled payments only, newest first. `from` and `to` bound the time Core recorded the payment. `nextCursor` is opaque; pass it back as `cursor`. A cursor Core did not issue returns `400`. Notes on the row fields:
- `agentLabel` is the agent's `ownerRef`, or its identity when it has none.
- `consensusAt` falls back to the recorded time until the Mirror Node's consensus time is stored.
- `flags` is `["fema_review"]` exactly when the reason is `receiver_non_resident` or `non_resident`.
- `sample` marks seeded demo history (A14): never on chain, so its HashScan link leads nowhere.

**`/v1/aggregates`** returns the current financial year (IST) unless `fy` is given, and accepts an optional `agentId`. `thresholdPaise` comes from the receiver (₹50,000 for a specified person). `tolerancePaise` is set only for an unverified payer under a `threshold_tolerant` receiver. `pct` is the share of the nearer of the two, to two decimals.

**`/v1/stream`** needs a `receiverId`. It sends `: connected` and then `data: <StreamEvent JSON>` per event, with a `: heartbeat` comment every 15 s. Each settlement sends:
- `payment.settled`, with the ledger row.
- `tds.withheld`, when TDS was reserved.
- `threshold.near`, once, on the payment that takes the pair from under 90% of its nearer limit to 90% or more. `promptLevel1` is true for a Level 0 payer.

Events are in-process: Core runs as one instance.

### Quarterly TDS export (A15)

`GET /v1/exports/tds?receiverId=&quarter=2026-Q3` answers `text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="kosha-tds-<quarter>.csv"`. A receiver key may leave `receiverId` out; the admin token must name one. An unknown quarter returns `400`.

- **Quarter:** the financial year's start year, then the quarter. With the April start, `2026-Q3` is 1 October to 31 December 2026, cut at midnight IST.
- **Rows:** one per settled payment to the receiver in that quarter that withheld TDS, sorted by deductee and then by time. Payments with no TDS (under the threshold, or with a non-resident side), pending or failed payments, and sample history are left out.
- **Format:** RFC 4180. The header is `tdsExportRowSchema`'s keys in order, cells are quoted only when needed, and lines end in CRLF.

| Column | Meaning |
| --- | --- |
| `deducteeRef` | The payer's account, masked (`0.0.6***`). Core never holds an agent's PAN; a payer with no PAN on file is prefixed with the statutory `PANNOTAVBL`. |
| `considerationPaise` | The API's price in paise at the quote's rate: the consideration, not including TDS |
| `tdsPaise` | The TDS `decide()` computed. Recovered exactly as `floor(tdsMicro × inrPerUsdMicro ÷ 10¹⁰)`, because decide rounds the paise up and then the micro-USDC up. |
| `rateBps` | 100 (1%) or 2000 (20%, no PAN) |
| `fundedBy` | Always `deductee_reserve`: the payer funded its own TDS into its 2-of-2 reserve (mode C) |
| `paymentDate`, `deductionDate` | The IST date of the settlement. One atomic transaction pays the price and reserves the TDS, so the two dates are the same. |
| `section` | `393(1)` |
| `hcsSequence` | The payment's HCS record, empty until the outbox has published it |
| `transactionId` | The Hedera transaction that settled it |

### Outside-payment watcher (A19)

A payer can still pay an API directly, outside Kosha. Every 30 seconds (`node-cron`, job `outside-watch`), Core reads each receiver wallet's new credits of the settlement token from the Mirror Node, from a per-wallet cursor (`WatcherCursor`). A wallet is watched from its first pass on; its earlier history is not flagged.

**What is flagged:** a credit whose sender is a declared wallet of a Kosha agent, and whose transaction Core did not settle. Kosha's own settlements are recognised by the transaction ID a quote claims before execution, so one still in flight is recognised too. The memo is never trusted, because anyone can write `kosha:` in one. Forwards and reserve releases come from Kosha's accounts, not from payer wallets, so they never match.

**What happens to a flagged payment.** Core never withholds on it. Under the pair's lock:
- the credit is stored as an `OutsidePayment` with its INR value;
- its `shortfallPaise` is the TDS `decide()` would have withheld against the pair's total at that moment;
- its value is added to the pair's `outsideValuePaise`, so it counts toward the threshold until classified;
- an HCS `outside` message is queued (`oid`, `tx`, HMAC pair ID, FY, value, shortfall), and `outside.payment` goes to the receiver's stream.

**Classify,** once, with the admin token or the receiver's own key:
- `consideration` keeps the value in the count.
- `not_consideration_gift`, which needs a `note`, takes it out of the count.
- Both queue an HCS `outside_resolved` message with the classification.
- Flagged payments never appear in the TDS export, which lists deductions only.

### Monthly close and reserve release (A20)

The TDS Kosha withholds sits in each payer's 2-of-2 reserve (mode C). The deductor pays the month's TDS in INR on the income-tax portal, and the reserve pays the deductor back. Months are IST calendar months, like the export's quarters. Scope is as above: the admin names a receiver; a receiver key acts for itself.

**`GET /v1/close`** is the payment summary: TDS per payer reserve (paise and micro-USDC), the deductee reference as in the export, the deductor's masked TAN (`MUMD*****E`; `TAN not on file` when it has none), the section, and the total. It counts settled live payments that withheld TDS; sample history is left out. It is computed on demand, so it can be read before and after the challan.

**`POST /v1/challans`** records that the challan was paid. The body carries the reference, but Core stores and logs only its SHA-256 (`challanRefHash`), so the reference can be proved later without being published. In one database transaction Core:
1. inserts the `Challan` (one per receiver and month; a second call returns `409`);
2. inserts one `Release` per payer reserve, `pending`, with the month's `tdsMicro` and an `expiresAt` 7 days out;
3. queues an HCS `challan` message: `cid`, `rcv` (an HMAC of the receiver, never its ID), `month`, `tds` and `hash`.

Then, for each release, Core creates a `ScheduleCreateTransaction` of a `TransferTransaction` reserve → deductor wallet, memo `kosha-release:<month>:<agentId>`, `waitForExpiry(false)`, Core as payer and admin key. Core's signature on the create is its half of the reserve's key list. A refused create leaves the release `pending`; the next `GET /v1/releases` retries it, and the stored expiry keeps the retry identical, so `IDENTICAL_SCHEDULE_ALREADY_CREATED` hands back the existing ID. A month with no TDS, or a receiver without a wallet, returns `400`. In the MVP the INR payment itself is mocked: any reference is accepted.

**`GET /v1/releases`** refreshes before it answers: pending releases are scheduled, and each scheduled one is checked on the Mirror Node (`executed`, `failed`, `deleted`, or `expired` once `expiresAt` has passed unsigned). A schedule counts as executed even when the transfer inside it fails, for example when the deductor's wallet dropped the token. So Core reads that transfer's result, and a failed one leaves the release `failed`, with the TDS still in the reserve.

**`POST /v1/releases/:id/cosign`** takes the agent operator's half: a `ScheduleSignTransaction` for the release's schedule, frozen with the agent's account as payer and signed by its key, serialized with `toBytes()` and sent as base64 in `transaction`. Core checks that it is a `ScheduleSignTransaction` for that schedule (`400` otherwise), that the release is `scheduled` (`409` otherwise), relays it as it is, and records the payer account in `cosignedBy`. A network refusal returns `502` with the status. With both signatures the transfer runs in that same transaction; the Mirror Node shows it a few seconds later, so the response may still say `scheduled` and the next read says `executed`. `pnpm cosign-release --release <rel_…>` does this with a seeded agent's key, standing in for HashPack, and prints the HashScan schedule link. A release from the pooled compatibility reserve (`POOL_RESERVE_ACCOUNT_ID`, Core + compliance) is signed with the compliance key instead. Core never holds an agent key.

**Job.** `monthly-close` (`node-cron`, 01:00 UTC on the 1st, 06:30 IST, once the IST month has ended) logs each receiver that withheld TDS in the month just ended, so its challan is due, and settles the fate of earlier releases (retries pending schedules, refreshes scheduled ones).

## Demo administration (A14)

Admin only. `pnpm seed --history` and `pnpm seed --reset-demo` call these. Parties are named the way the seed knows them: the agent's identity and the receiver's wallet account.

| Method and path | Auth | Request | Response |
| --- | --- | --- | --- |
| `POST /v1/admin/sample-payments` | admin | `demo-admin` `samplePaymentsRequestSchema` | `demo-admin` `samplePaymentsResponseSchema` |
| `POST /v1/admin/demo-reset` | admin | `demo-admin` `demoResetRequestSchema` | `demo-admin` `demoResetResponseSchema` |

**Sample payments** are written oldest first as settled payments with `sample: true`. Each is taxed by `decide()` against the pair's running total, like a live payment, and adds to the aggregate. They have no transaction on chain and no HCS record, so a sample row's HashScan link leads nowhere. A sample whose `key` was already recorded is skipped. If any party is not registered, the call returns `400` and writes nothing. Samples count toward thresholds, not toward spending caps (A12).

**Demo reset** runs in one database transaction:
1. Clears each `clearAgents` agent's own (non-sample) payments, their unpublished HCS rows, and its unpaid quotes.
2. Sets each `balances` pair to one sample "opening balance" payment worth `valuePaise`, dated a day back (or now, when a day back falls in the last financial year). Every other payment of that pair this year is removed.
3. Recounts every touched pair's aggregate from the payments that remain.
4. Sends each `level0` agent back to Level 0: residency `unknown`, no PAN, no credential.

HCS messages already published stay on chain, so after a reset the topic's running totals no longer match the database for the reset pairs.

## Deploy (A16)

Core runs on Fly.io from `apps/core/Dockerfile` and `apps/core/fly.toml` (Mumbai, `/health` check). Deploy it before the demo APIs and the Console, because both call it. Everything stays on testnet. A person runs these commands; the agents never deploy.

**Image.** It keeps the pnpm workspace, installs only Core's dependency graph, and runs `src/server.ts` with `tsx`, like the demo APIs' images. A `pnpm deploy` bundle won't work: Core finds its env and rule pack from the workspace root, and the internal packages export TypeScript source. `CORE_PORT=8080` and `RULEPACK_PATH=rulepacks/in-2026.2.json` are set in the image. Pending migrations run at startup, before the server listens. To check it locally: `docker build -f apps/core/Dockerfile -t kosha-core .`

**One machine, always on.** Core must run as exactly one instance:
- the live-event bus is in process;
- the HCS outbox and the compatibility forwarder loops run inside it. The outbox keeps each topic in order, assigns each message's transaction ID before submitting it, and after an unknown outcome asks the Mirror Node about that ID before posting again, so no message is posted twice. A message too large for one 1,024-byte chunk is set aside (`abandonedAt`) instead of blocking the queue;
- compat funds wait in Kosha's settlement account until a forward goes out.

So `fly.toml` keeps one machine up and never stops it.

**No CORS.** No browser calls Core. The Console calls it only from Next.js server code (PROTOCOL §2), and agents and browsers talk to Gate. So Core sends no CORS headers; add them only if a browser client ever needs Core directly.

```bash
fly auth login
fly apps create kosha-core

# Postgres: Fly's own (attach sets DATABASE_URL as a secret), or any Postgres 16 URL
fly postgres create --name kosha-core-db --region bom
fly postgres attach kosha-core-db --app kosha-core

# Secrets: copy each value from the shared env file (never commit or paste them anywhere else)
fly secrets set --app kosha-core \
  HEDERA_NETWORK=testnet MIRROR_URL=https://testnet.mirrornode.hedera.com \
  CORE_ACCOUNT_ID=... CORE_PRIVATE_KEY=... ISSUER_PRIVATE_KEY=... \
  SETTLEMENT_TOKEN_ID=... HCS_PAYMENTS_TOPIC=... \
  COMPAT_SETTLEMENT_ACCOUNT_ID=... POOL_RESERVE_ACCOUNT_ID=... \
  MAX_TX_FEE_HBAR=2 FX_DEMO_INR_PER_USD=88.40 \
  PAIR_HMAC_SECRET=... PAN_COMMIT_SECRET=... CONSOLE_ADMIN_TOKEN=...

fly deploy . --config apps/core/fly.toml --dockerfile apps/core/Dockerfile \
  --ignorefile apps/core/Dockerfile.dockerignore
fly scale count 1 --app kosha-core

# Check it, then seed the demo against it from your machine
curl https://kosha-core.fly.dev/health
CORE_URL=https://kosha-core.fly.dev pnpm seed --profiles --history --reset-demo
```

Core refuses to start until every secret is set, and it names each missing key (never its value) in `fly logs`. Then point the demo APIs' and the Console's `CORE_URL` at `https://kosha-core.fly.dev` (README, "Deploy").

| Secret | From |
| --- | --- |
| `HEDERA_NETWORK`, `MIRROR_URL` | `testnet` and the testnet Mirror Node |
| `CORE_ACCOUNT_ID`, `CORE_PRIVATE_KEY` | Core's operator account (human step H2) |
| `ISSUER_PRIVATE_KEY` | The test credential issuer (bootstrap) |
| `SETTLEMENT_TOKEN_ID` | tUSDC from bootstrap, or Circle testnet USDC `0.0.429274` after H5 |
| `HCS_PAYMENTS_TOPIC` | Bootstrap |
| `COMPAT_SETTLEMENT_ACCOUNT_ID`, `POOL_RESERVE_ACCOUNT_ID` | Bootstrap |
| `MAX_TX_FEE_HBAR`, `FX_DEMO_INR_PER_USD` | `2` and `88.40` |
| `PAIR_HMAC_SECRET`, `PAN_COMMIT_SECRET`, `CONSOLE_ADMIN_TOKEN` | Bootstrap |
| `DATABASE_URL` | Set by `fly postgres attach` |

## Fixtures

`@kosha/shared/fixtures` exports one parsed example per read schema (`LEDGER_PAGE_FIXTURE`, `AGGREGATES_FIXTURE`, `STREAM_EVENTS_FIXTURE`, `TDS_EXPORT_FIXTURE`, `MONTHLY_CLOSE_FIXTURE`, and so on). The Console serves them under `KOSHA_MOCK=1` until Core serves real data. Core's responses must parse with the same schemas.

## Headers

`headers` holds every header name: `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`, the legacy `X-PAYMENT`, `X-KOSHA-AGENT` and `X-KOSHA-TAX`. It also holds the CORS lists and `encodeHeader` / `decodeHeader` (base64 of UTF-8 JSON).
