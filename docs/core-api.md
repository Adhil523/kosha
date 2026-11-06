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
| `POST /v1/decide` | receiver | `facilitator-api` `decideRequestSchema` | `facilitator-api` `decideResponseSchema` | A24 |
| `POST /v1/decisions/:id/confirm` | receiver | `facilitator-api` `decisionConfirmSchema` | `facilitator-api` `decideResponseSchema` | A24 |

The quote's `kosha-split` entry must pass `split-quote` `checkSplitQuote()`; Kosha Pay runs the same check before signing.

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

## Registry

| Method and path | Auth | Request | Response | Task |
| --- | --- | --- | --- | --- |
| `GET /v1/receivers/challenge` | admin | — | `registry` `receiverChallengeSchema` | A07 |
| `POST /v1/receivers` | admin | `registry` `receiverCreateSchema` | `registry` `receiverCreatedSchema`; `409` if a wallet is already registered | A07 |
| `POST /v1/agents` | admin | `registry` `agentRegisterSchema` | `registry` `agentRowSchema` | A07 |
| `GET /v1/agents` | admin | — | array of `registry` `agentRowSchema`, oldest first; `[]` when none | #47 |
| `GET /v1/agents/:id` | admin | — | `registry` `agentRowSchema` | A07 |
| `GET` / `PUT /v1/agents/:id/policy` | admin | `registry` `policySchema` | `registry` `policySchema` | A12 |
| `POST /v1/terms` | receiver | `registry` `termsProposalSchema` | `registry` `termsAnswerSchema` | A21 (optional) |

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
| `GET /v1/outside-payments?receiverId=` | admin | — | array of `console-api` `outsidePaymentRowSchema` | A19 (optional) |
| `POST /v1/outside-payments/:id/classify` | admin | `tax-reports` `outsideClassifySchema` | `console-api` `outsidePaymentRowSchema` | A19 (optional) |
| `GET /v1/close?receiverId=&month=` | admin | `tax-reports` `monthSchema` | `tax-reports` `monthlyCloseSchema` | A20 (optional) |
| `POST /v1/challans` | admin | `tax-reports` `challanRecordSchema` | `tax-reports` `challanRowSchema` | A20 (optional) |
| `GET /v1/releases?challanId=` | admin | — | array of `tax-reports` `releaseRowSchema` | A20 (optional) |
| `POST /v1/releases/:id/cosign` | admin | signed `ScheduleSignTransaction` bytes (base64) | `tax-reports` `releaseRowSchema` | A20 (optional) |
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

## Fixtures

`@kosha/shared/fixtures` exports one parsed example per read schema (`LEDGER_PAGE_FIXTURE`, `AGGREGATES_FIXTURE`, `STREAM_EVENTS_FIXTURE`, `TDS_EXPORT_FIXTURE`, `MONTHLY_CLOSE_FIXTURE`, and so on). The Console serves them under `KOSHA_MOCK=1` until Core serves real data. Core's responses must parse with the same schemas.

## Headers

`headers` holds every header name: `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`, the legacy `X-PAYMENT`, `X-KOSHA-AGENT` and `X-KOSHA-TAX`. It also holds the CORS lists and `encodeHeader` / `decodeHeader` (base64 of UTF-8 JSON).
