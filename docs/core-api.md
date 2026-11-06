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

## Registry

| Method and path | Auth | Request | Response | Task |
| --- | --- | --- | --- | --- |
| `GET /v1/receivers/challenge` | admin | — | `registry` `receiverChallengeSchema` | A07 |
| `POST /v1/receivers` | admin | `registry` `receiverCreateSchema` | `registry` `receiverCreatedSchema` | A07 |
| `POST /v1/agents` | admin | `registry` `agentRegisterSchema` | `registry` `agentRowSchema` | A07 |
| `GET /v1/agents/:id` | admin | — | `registry` `agentRowSchema` | A07 |
| `GET` / `PUT /v1/agents/:id/policy` | admin | `registry` `policySchema` | `registry` `policySchema` | A12 |
| `POST /v1/terms` | receiver | `registry` `termsProposalSchema` | `registry` `termsAnswerSchema` | A21 (optional) |

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

## Fixtures

`@kosha/shared/fixtures` exports one parsed example per read schema (`LEDGER_PAGE_FIXTURE`, `AGGREGATES_FIXTURE`, `STREAM_EVENTS_FIXTURE`, `TDS_EXPORT_FIXTURE`, `MONTHLY_CLOSE_FIXTURE`, and so on). The Console serves them under `KOSHA_MOCK=1` until Core serves real data. Core's responses must parse with the same schemas.

## Headers

`headers` holds every header name: `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`, the legacy `X-PAYMENT`, `X-KOSHA-AGENT` and `X-KOSHA-TAX`. It also holds the CORS lists and `encodeHeader` / `decodeHeader` (base64 of UTF-8 JSON).
