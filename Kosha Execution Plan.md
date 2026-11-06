# Kosha: Execution Plan

Nov 6, 2026 · @Adhil · **v2**: updated with [findings and design updates](docs/agents/kosha-findings-and-design-updates.md) (called "findings" below), the B00 research in `docs/research/`, and a review against the Hedera skills (`hedera-dev/hedera-skills`). Work that can't be fixed in the plan (validation, business model, network impact) is in [docs/hackathon-readiness.md](docs/hackathon-readiness.md).

## Product overview

**Kosha** (Sanskrit कोश, "treasury") is a tax-native x402 payment gateway on Hedera: AI agents pay Indian APIs in USDC, and Indian TDS is withheld on every payment at the moment it settles. Tagline: *Every agent payment, tax-ready.* Replaces the working title Kar402; check the name for trademark and npm-scope clashes before submission.

**Pitch line:** In India, when a bot pays your API in USDC, *you* may owe tax on the bot's payment. Kosha handles it automatically.

**What you get at the end:** infrastructure, not a consumer dApp. It's a payment gateway that developers plug into, like Razorpay for AI agents, with four components:

| Component | What it is | Who uses it | Ships as |
| --- | --- | --- | --- |
| **Kosha Core** | The facilitator: quotes, verifies and settles x402 payments on Hedera, runs the tax engine, logs to HCS, sweeps escrow | Runs as a service | Node.js server (`apps/core`) |
| **Kosha Gate** | Server SDK: middleware that makes any API endpoint return 402 and get paid through Kosha | Indian API owners | npm `@kosha/gate` |
| **Kosha Pay** | Agent client library: pays Kosha-protected endpoints, carries the tax profile, enforces spending rules | Agent developers | npm `@kosha/pay` (+ Hedera Agent Kit plugin) |
| **Kosha Console** | Web dashboard: earnings, TDS ledger, escrow, filing export, agent spend and policies | API owners, agent owners, their CA | Next.js app (`apps/console`) |

**Legal basis (unsettled; confirm with a CA):** USDC is a virtual digital asset (VDA). Section 393(1) of the Income-tax Act 2025 (formerly 194S) requires 1% TDS (20% with no PAN) on VDA transfers. The agent hands over USDC, so it is the **seller of the VDA and the deductee**. The API receives USDC for a service, so it is the **buyer and the deductor**. The yearly threshold is keyed to the **buyer**: ₹50,000 when the API owner is a specified person, ₹10,000 otherwise (findings §2.1, §3.1).

## Design decisions that fix the drawbacks

Kosha's guarantee is narrow and honest: **an API owner using Kosha never under-deducts on the payments Kosha can see, under the policy the owner chose.** The `strict` policy gives the strongest form of this guarantee. Every decision below serves it, and every tax rule is configurable, because the law is unsettled.

| Drawback | Decision | How it's built |
| --- | --- | --- |
| The blockchain can't tell who is Indian | Residency comes from verified profiles, never from wallets or IP addresses | Receiver: onboarded API owner with PAN (plus TAN and GSTIN for larger businesses). Payer: credential (KYC issuer, Tax Residency Certificate, or signed declaration) referenced from its HCS-14 agent identity |
| Verification is a burden for people who owe nothing | **Step-by-step verification** (findings §4.4) | Level 0: none, works at once. Level 1: PAN name-matched (1%) or non-resident declaration (0%), prompted by `threshold.near`. Level 2: full KYC for large payers. Small API owners (specified persons) need PAN and a wallet signature only |
| Unverified payers | **The API owner chooses the policy** | `strict`: 20% from the first rupee. `threshold_tolerant` (default): no tax while the pair stays within a tolerance (₹5,000, half the lowest threshold), then 20% until the payer reaches Level 1 |
| Payments made outside Kosha break the yearly threshold | Count everything visible; flag, never withhold; let receivers switch thresholds off | Mirror Node watcher **flags** USDC reaching receiver wallets outside Kosha. The owner can mark one "not consideration: gift from a relative". Payers declare all their wallets. **First-rupee mode** for owners who want no risk |
| Who bears the 1%? | **Mode C: payer-funded into the agent's own reserve** (findings §2) | The API receives exactly its net price. The TDS goes to a **reserve account owned by the agent**, with a 2-of-2 key (agent operator + Kosha). The seller funds its own tax and the buyer gets proof, which is the closest fit to CBDT's in-kind guidance. Price-inclusive mode is **dropped**: it makes the API bear the tax, which brings back tax on tax |
| One listed price can't fit 0%, 1% and 20% buyers | **All-in price per quote** | The API sets its net price once. Core computes the all-in total for each quote after `decide()`: "₹101 total: ₹100 to the API, ₹1 TDS reserved in your name" |
| The law may be read differently | Rules live in versioned, signed **rule packs**, not in code | `rulepacks/in-2026.2.json` holds thresholds, rates, the tax base, crossing behaviour and the unverified-payer policy. Each decision records the rule-pack version, and the pack's hash is published to HCS |
| Threshold crossing is ambiguous (whole payment or excess) | Withhold on the **whole crossing payment** | Rule-pack flag `crossing: "full"`; switchable to `"excess"` |
| PAN and business relationships are private | No PAN or counterparty names on-chain | Salted PAN commitments; HCS logs carry payment ID, amounts, rule version, the pair's running total and an HMAC pair ID only |
| Fractions of a paisa | Compute in paise, round **up**, settle in USDC micro-units (6 decimals) | Never under-deduct by rounding; the reserve accumulates and is released monthly |
| HTS custom fees can't be added to existing USDC | Use a native multi-party transfer | One `TransferTransaction` moves payer → API (price) and payer → **its own reserve** (TDS) atomically |
| Facilitator is the fee payer, so a malicious client could slip in a debit from it | Verify the transfer list strictly before signing | Exactly the quoted transfers, only debits from the payer, the reserve leg goes to the payer's own reserve, no HBAR movement, correct token, quote ID in the memo, quoted nodes, fee cap |
| Replay of a payment | One quote, one settlement | Quote IDs with a 120-second expiry; Hedera transaction IDs and quote IDs stored as used |
| Standard x402 clients can't sign Kosha's split | **Two entries in `accepts[]`** | `kosha-split` (atomic, for Kosha Pay) and a plain `exact` **compatibility** entry that pays Kosha's settlement account; Core forwards the price and holds the TDS in a pooled reserve in the payer's name (brief custody, two transactions) |
| Other facilitators and chains can't use Kosha | **Standalone tax engine** | `POST /v1/decide` returns a decision for any settlement rail, and every decision is logged to HCS, whatever chain the payment settles on |
| "Isn't this web2?" | Make the edges verifiable on-chain (findings §6) | Rule-pack hash and running totals on HCS (recompute every decision); Gate checks on-chain that the reserve leg settled before serving data; the reserve releases only by co-signed scheduled transaction |
| On-chain logs aren't filings | Generate filing data, keep logs as evidence | Quarterly CSV export in the statement's field layout; HCS sequence numbers referenced per row; each row states "consideration, TDS, funded by the deductee" |
| Paying the tax in rupees | **Reimbursement**, not conversion (findings §1.2) | The deductor pays the challan in INR on the portal and records the reference in Console; then a co-signed scheduled transaction releases the reserve to them. Converting the reserve to INR would trigger another 1% TDS |
| Payments to foreign APIs | Out of scope for TDS; flagged | Non-resident path records the payment with a "FEMA review" flag. GST under reverse charge is a stretch goal (Phase 3) |

## Architecture and payment flow

One paid request takes two HTTP round trips and one Hedera transaction; the tax is decided at quote time and enforced at settlement.

&#91;embedded content: Kosha architecture · 4 components on Hedera\]

The agent only talks to the API; the API's Gate talks to Core; only Core touches Hedera as fee payer.

Header and field names follow **x402 v2** (`docs/research/x402.md`): `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`, network `hedera:testnet`.

1. The agent (Kosha Pay) calls the API with its identity in `X-KOSHA-AGENT`: its HCS-14 UAID, or for a Level 0 agent its CAIP-10 account (`hedera:testnet:0.0.x`).
2. Kosha Gate asks Core for a quote. Core loads both profiles, converts the price to ₹, reads the pair's yearly total, runs the tax engine and computes the all-in price.
3. Gate returns **402** with a `PAYMENT-REQUIRED` header listing two options: `kosha-split` (price to the API, TDS to the agent's own reserve, Core as fee payer) and the `exact` compatibility entry.
4. Pay checks the quote against the owner's spending rules, signs exactly those transfers, and retries with `PAYMENT-SIGNATURE`.
5. Gate calls Core's verify, then settle. Core checks every transfer, adds its fee-payer signature, and executes one atomic `TransferTransaction`.
6. On `SUCCESS`, Core writes the ledger, adds the payment to the pair's total, and logs a privacy-safe message (with the pair's new running total) to the HCS payments topic, which only Core can write to.
7. Gate confirms on the Mirror Node that the reserve leg settled, then returns the data with `PAYMENT-RESPONSE` (transaction ID, HashScan link, tax reserved).
8. In the background, the watcher flags USDC that reached the API outside Kosha. Monthly, after the deductor records the INR challan, a co-signed scheduled transaction releases the reserve to them as reimbursement.

## Tech stack and repo layout

Everything is TypeScript in one pnpm + Turborepo monorepo, and **no Solidity**, which keeps Hedera's "No Solidity Allowed" prize open.

| Layer | Choice | Why |
| --- | --- | --- |
| Language and runtime | TypeScript 6.0, Node.js 24 LTS (**24.22.1 or later**, required by Agent Kit v4) | One language across all four components |
| Monorepo | pnpm workspaces + Turborepo | Shared types and parallel builds |
| Hedera | **`@hiero-ledger/sdk` 2.90+**, never `@hashgraph/sdk` (frozen at 2.81.0) | `TransferTransaction`, HCS topics, `ScheduleCreateTransaction`, token association. `@x402/hedera` and Agent Kit v4 use the same SDK, so SDK objects can pass between them |
| x402 | **`@x402/core` and `@x402/hedera` 2.30+** (x402 v2) | Header codecs and types; `x402Client` in Pay with a custom `kosha-split` scheme; the official `exact` facilitator scheme verifies compatibility payments |
| Hedera reads | Mirror Node REST (`testnet.mirrornode.hedera.com`) | Payment confirmation, Gate's reserve-leg proof, the outside-payment watcher |
| Agent identity | HCS-14 UAID + HCS-11 profile via `@hashgraphonline/standards-sdk` | Hedera bonus; the agent's tax credential is referenced from `profile.properties.kosha` |
| Agent | **Hedera Agent Kit v4** (`@hashgraph/hedera-agent-kit` + `@hashgraph/hedera-agent-kit-langchain`) + LangChain v1 | Hedera bonus. `kosha_paid_fetch` is a **`BaseTool`** in a kit plugin, so the kit's policies (Kosha's budget policy) and hooks (`HcsAuditTrailHook`) actually run. The old `hedera-agent-kit` package is deprecated |
| Validation | **Zod 4.6.7, pinned exactly** | The kit pins it; any other version gives two copies and breaks `Tool.parameters` types |
| Settlement token | Circle testnet USDC `0.0.429274` (HTS, 6 decimals) for the recorded demo; a minted `tUSDC` for development | Hedera bonus. The faucet gives 20 USDC per 2 hours, too little for burst runs |
| Core server | Fastify 5 + Zod + `fastify-type-provider-zod` | Fast, typed request validation |
| Database | PostgreSQL 16 + Drizzle ORM (Docker locally, PGlite in tests) | Profiles, quotes, aggregates, decisions, nonces |
| Jobs | `node-cron` inside Core | Mirror Node watcher, monthly close and reserve release |
| FX rate | Pluggable adapter: fixed demo rate → reference-rate API → Chainlink feed | Rule pack names the source; confirm with a CA which rate tax law expects (SBI TT buying rate is common practice) |
| Gate SDK | Express and Hono middleware, built with `tsup` | Works with the most common Node servers |
| Console | Next.js 15 (App Router), Tailwind, shadcn/ui, Recharts, TanStack Query | Fast to build, looks polished in the demo |
| Console auth | Demo sign-in behind `DEMO_AUTH=1`; HashPack (WalletConnect) for the release co-sign is a stretch goal that raises the Integration score | API owners and CAs may not use wallets |
| Tests | Vitest (unit, plus `fast-check` properties), Playwright (Console), testnet end-to-end script | The tax engine needs exhaustive unit tests |
| Deploy | Railway or Fly.io (Core, demo APIs), Vercel (Console) | Public URLs for judges |

```
kosha/
├─ apps/
│  ├─ core/            # Kosha Core: facilitator + tax engine host + jobs
│  ├─ console/         # Kosha Console: Next.js dashboard
│  ├─ demo-api-in/     # Indian data API using @kosha/gate
│  ├─ demo-api-global/ # Foreign API using @kosha/gate (non-resident path)
│  └─ demo-agent/      # Research agent on Hedera Agent Kit + @kosha/pay
├─ packages/
│  ├─ tax-engine/      # Pure functions + rule packs, no I/O
│  ├─ gate/            # @kosha/gate server SDK
│  ├─ pay/             # @kosha/pay client library
│  ├─ hedera/          # Transfer build/verify, HCS, schedules, mirror client
│  └─ shared/          # Zod schemas, types, constants
├─ rulepacks/
│  └─ in-2026.2.json   # Thresholds, rates, tax base, crossing rule, unverified-payer policy, FX source
├─ scripts/            # Account setup, topics, faucet, demo run
├─ arkiv/              # Only if Arkiv is one of the three sponsor picks
└─ README.md           # Setup, architecture, payment flow, HashScan links
```

## Component 1: Kosha Core

Kosha Core is the facilitator: it prices each request with tax, checks the signed transfer, settles it on Hedera with Core as fee payer, logs it to HCS, and keeps the tax ledger. Kosha runs its own facilitator, which the Hedera track allows. The official Hedera `exact` scheme rejects any credit other than `payTo`, so the atomic split is a Kosha scheme, `kosha-split`; plain `exact` is served through compatibility mode.

### Modules

1. **Quote service:** builds the x402 payment requirements: the `kosha-split` entry (price and reserve legs, all-in total, tax breakdown) and the `exact` compatibility entry.
2. **Tax engine** (`packages/tax-engine`): pure functions plus a rule pack. No network or database access, so it's fully unit-testable. Also served alone as `POST /v1/decide`.
3. **Verifier:** decodes the payer's signed `TransferTransaction` and checks it matches the quote exactly.
4. **Settler:** adds Core's fee-payer signature, executes, waits for the receipt, writes the ledger and the HCS log. In compatibility mode it also sends the forwarding transaction.
5. **Profile registry:** receivers (API owners), payer agents with their verification level and reserve account, credentials, declared wallets.
6. **Watcher job:** reads the Mirror Node for USDC reaching receivers' wallets outside Kosha, and flags it.
7. **Monthly close and release:** totals TDS per deductor and payer, records the INR challan, then releases each reserve through a co-signed scheduled transaction.
8. **Exports:** the quarterly TDS file for receivers, and the per-payment gains report for payers.

### API

| Method and path | Purpose | Called by |
| --- | --- | --- |
| `POST /v1/quote` | Price plus tax for one request; returns x402 v2 `accepts[]` (`kosha-split` + `exact` compatibility) | Kosha Gate |
| `POST /v1/verify` | Check a v2 payment payload (`{ x402Version, paymentPayload, paymentRequirements }`) against its quote; returns `{ isValid, invalidReason?, payer? }` | Kosha Gate |
| `POST /v1/settle` | Sign as fee payer, execute, log; returns the v2 settlement response, with transaction ID, HashScan URL and HCS sequence in `extensions.kosha` | Kosha Gate |
| `GET /v1/supported` | v2 `kinds[]` (`kosha-split` and `exact` on `hedera:testnet`, with `extra.feePayer`), active rule pack and its hash | Anyone |
| `POST /v1/decide` | Tax decision only, for any facilitator or chain; logged to HCS. `POST /v1/decisions/:id/confirm` reports the settled transaction | Other facilitators |
| `POST /v1/receivers` | Onboard an API owner (PAN, TAN and GSTIN where needed, specified-person status, residency, wallets with a signed ownership challenge, mode, unverified-payer policy) | Console |
| `POST /v1/agents` | Register a payer agent: HCS-14 UAID, credential (Level 1 or 2), declared wallets. Core creates the agent's reserve account. Level 0 agents are registered automatically on their first quote | Kosha Pay / Console |
| `GET /v1/ledger` | Payments and withholdings, filterable | Console |
| `GET /v1/exports/tds?receiverId=&quarter=2026-Q3` | Quarterly TDS file (CSV) | Console |
| `GET /v1/close?receiverId=&month=2026-11` / `POST /v1/challans` | Monthly payment summary; record the INR challan reference, which triggers the reserve releases | Console |
| `GET /v1/payers/:id/report` | INR value and gain or loss for each lot spent | Console |
| `POST /v1/webhooks` | Subscribe to `payment.settled`, `tds.withheld`, `threshold.near`, `outside.payment` | API owners |

### Payment requirements Core returns

Gate sends this as base64 JSON in the `PAYMENT-REQUIRED` header, and as the 402 body.

```json
{
  "x402Version": 2,
  "error": "PAYMENT-SIGNATURE header is required",
  "resource": { "url": "https://api.demo-in.dev/v1/gst-lookup", "description": "GSTIN lookup", "mimeType": "application/json" },
  "accepts": [
    {
      "scheme": "kosha-split", "network": "hedera:testnet", "asset": "0.0.429274",
      "payTo": "0.0.5001", "amount": "100000", "maxTimeoutSeconds": 120,
      "extra": {
        "feePayer": "0.0.4000",
        "kosha": {
          "quoteId": "q_7f3a", "memo": "kosha:q_7f3a", "expiresAt": "2026-11-06T10:32:00Z",
          "nodeAccountIds": ["0.0.3", "0.0.4", "0.0.5"],
          "totalMicro": "101019",
          "transfers": [
            { "account": "0.0.5001", "amount": "100000", "leg": "consideration" },
            { "account": "0.0.6101", "amount": "1019", "leg": "tds_reserve" }
          ],
          "tax": { "rulepack": "in-2026.2", "rateBps": 100, "inrValuePaise": "884", "tdsMicroUsdc": "1019",
                   "funding": "payer_reserve", "reason": "threshold_crossed", "flags": [] }
        }
      }
    },
    {
      "scheme": "exact", "network": "hedera:testnet", "asset": "0.0.429274",
      "payTo": "0.0.4200", "amount": "101019", "maxTimeoutSeconds": 120,
      "extra": { "feePayer": "0.0.4000", "kosha": { "quoteId": "q_7f3b", "mode": "compat" } }
    }
  ]
}
```

Amounts are USDC micro-units. 100000 is 0.10 USDC to the API (`amount` is the net credit to `payTo`, as in the official scheme). 1019 is the TDS into the agent's own reserve `0.0.6101`: 1% of ₹8.84 is 8.84 paise, rounded up to 9 paise, converted at ₹88.40 and rounded up again. The memo carries the quote ID only, because Hedera allows one memo (100 bytes) per transaction; the leg labels live in the quote, the HCS record and the export.

**Compatibility entry:** `payTo` is Kosha's settlement account `0.0.4200` and `amount` is the all-in total. Any x402 v2 client can pay it. Core then forwards the price to the API and holds the TDS in a pooled reserve (2-of-2 Core + compliance) in the payer's name. A caller without `X-KOSHA-AGENT` is unverified, so the receiver's unverified-payer policy prices this entry.

**Unverified payers:** the `kosha-split` entry also carries `extra.kosha.register`, a link that explains how to reach Level 1 and drop from 20% to 1%.

### Rule pack

```json
{
  "id": "in-2026.2",
  "supersedes": "in-2026.1",
  "law": "Income-tax Act 2025, s.393(1) (formerly s.194S, 1961 Act)",
  "effectiveFrom": "2026-04-01",
  "financialYearStart": "04-01",
  "taxBase": "price",
  "rates": { "standardBps": 100, "noPanBps": 2000 },
  "thresholds": { "keyedTo": "buyer", "specifiedBuyerPaise": 5000000, "otherBuyerPaise": 1000000 },
  "crossing": "full",
  "unverifiedPayer": { "defaultPolicy": "threshold_tolerant", "toleranceLimitPaise": 500000 },
  "funding": "payer_reserve",
  "nonResidentPayer": "no_tds_flag_fema",
  "nonResidentReceiver": "no_tds_flag_fema",
  "fxSource": "demo-fixed",
  "reviewedBy": null
}
```

`reviewedBy` stays `null` until a CA signs off, and the Console shows "unreviewed rule pack" until then. `taxBase: "price"` makes sure the base is the API's price, never the all-in total. Core publishes the SHA-256 of the canonical pack to HCS when it first loads it, so anyone can check which rules decided a payment.

### Tax engine core function

```ts
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const minBig = (a: bigint, b: bigint) => (a < b ? a : b);

export function decide(i: {
  payer: { residency: 'resident' | 'non_resident' | 'unknown'; panOnFile: boolean }; // the deductee: sets the rate
  receiver: {                                    // the buyer and deductor: sets the threshold
    residency: 'resident' | 'non_resident';
    specifiedPerson: boolean;
    mode: 'threshold' | 'first_rupee';
    unverifiedPolicy: 'strict' | 'threshold_tolerant';
  };
  priceMicroUsdc: bigint;      // the API's net price = the tax base
  inrPerUsdMicro: bigint;      // e.g. 88_400_000n = Rs 88.40 per USD
  aggregatePaise: bigint;      // settled + outside + open quotes, this pair, this financial year
  pack: RulePack;
}): Decision {
  const valuePaise = ceilDiv(i.priceMicroUsdc * i.inrPerUsdMicro * 100n, 10n ** 12n);
  const none = (reason: Reason, flags: Flag[] = []): Decision =>
    ({ rulepack: i.pack.id, valuePaise, applies: false, rateBps: 0, tdsPaise: 0n, tdsMicroUsdc: 0n, reason, flags });

  if (i.receiver.residency === 'non_resident') return none('receiver_non_resident', ['fema_review']);
  if (i.payer.residency === 'non_resident') return none('non_resident', ['fema_review']);

  const unverified = i.payer.residency === 'unknown';
  const rateBps = unverified || !i.payer.panOnFile ? i.pack.rates.noPanBps : i.pack.rates.standardBps;
  const legal = BigInt(i.receiver.specifiedPerson
    ? i.pack.thresholds.specifiedBuyerPaise : i.pack.thresholds.otherBuyerPaise);
  const threshold = !unverified ? legal
    : i.receiver.unverifiedPolicy === 'strict' ? 0n
    : minBig(legal, BigInt(i.pack.unverifiedPayer.toleranceLimitPaise));
  const firstRupee = i.receiver.mode === 'first_rupee' || threshold === 0n;
  const after = i.aggregatePaise + valuePaise;

  if (!firstRupee && after <= threshold) return none(unverified ? 'within_tolerance' : 'under_threshold');

  const taxable = !firstRupee && i.pack.crossing === 'excess' && i.aggregatePaise < threshold
    ? after - threshold : valuePaise;
  const tdsPaise = ceilDiv(taxable * BigInt(rateBps), 10_000n);
  const tdsMicroUsdc = ceilDiv(tdsPaise * 10n ** 12n, i.inrPerUsdMicro * 100n); // paise -> USDC micro, rounded up
  const reason = firstRupee ? 'first_rupee' : unverified ? 'tolerance_exceeded' : 'threshold_crossed';
  return { rulepack: i.pack.id, valuePaise, applies: true, rateBps, tdsPaise, tdsMicroUsdc, reason, flags: [] };
}

// Mode C: the API gets exactly its price; the TDS goes to the payer's own reserve.
export const applyFunding = (priceMicro: bigint, d: Decision) =>
  ({ receiverMicro: priceMicro, reserveMicro: d.tdsMicroUsdc, payerTotalMicro: priceMicro + d.tdsMicroUsdc });
```

### Verifier: the checks that protect the fee payer

```ts
import { Transaction, TransferTransaction, PublicKey } from '@hiero-ledger/sdk';

export async function verify(bytes: Uint8Array, q: Quote, payerKey: PublicKey) {
  const tx = Transaction.fromBytes(bytes);
  if (!(tx instanceof TransferTransaction)) fail('not_transfer');
  if (tx.transactionId?.accountId?.toString() !== q.feePayer) fail('wrong_fee_payer');
  if (tx.transactionMemo !== `kosha:${q.id}`) fail('memo_mismatch');
  if (!sameIds(tx.nodeAccountIds, q.nodeAccountIds)) fail('wrong_nodes');   // signed for every quoted node
  if (tx.maxTransactionFee.toTinybars().gt(MAX_FEE_TINYBARS)) fail('fee_too_high');
  if (tx.hbarTransfers.size > 0) fail('hbar_movement');          // nothing may debit Core in HBAR
  if (Date.now() > q.expiresAt) fail('quote_expired');
  if (await store.isUsed(q.id) || await store.isUsedTx(tx.transactionId!.toString())) fail('replay');
  if (q.reserveLeg && q.reserveLeg.account !== q.payerReserveAccount) fail('reserve_not_payers'); // mode C

  const expected = new Map<string, bigint>([[q.payer, -q.totalMicro], ...q.transfers.map(t => [t.account, t.amount] as const)]);
  let tokenCount = 0;
  for (const [tokenId, moves] of tx.tokenTransfers) {
    tokenCount++;
    if (tokenId.toString() !== q.asset) fail('wrong_token');
    if (moves.size !== expected.size) fail('transfer_count');
    for (const [acct, amt] of moves)
      if (expected.get(acct.toString()) !== BigInt(amt.toString())) fail('amount_mismatch');
  }
  if (tokenCount !== 1) fail('token_count');
  if (!payerKey.verifyTransaction(tx)) fail('bad_signature');  // payer key from Mirror Node
  return tx as TransferTransaction;
}
```

Check the SDK's exact types for `tokenTransfers` against the version you install. The pseudo-code shows the checks; the real verifier returns a `{ ok, code }` result instead of throwing. Expiry, replay and the payer's reserve need the database, so Core runs them around the pure verifier in `@kosha/hedera`.

### Settler

```ts
export async function settle(tx: TransferTransaction, q: Quote) {
  await store.markUsed(q.id, tx.transactionId!.toString());     // before execute: no double spend on retry
  const resp = await (await tx.sign(coreKey)).execute(client);
  const receipt = await resp.getReceipt(client);                 // throws unless SUCCESS; on timeout, reconcile via Mirror Node
  const txId = resp.transactionId.toString();
  const agg = await ledger.record(q, txId);                      // one DB transaction: payment, aggregate += value, HCS outbox row
  const seq = await hcs.log({ v: 2, t: 'pay', pid: q.paymentId, tx: txId, rp: q.tax.rulepack, rph: rulepackHash8,
                              price: q.price.toString(), tds: q.tds.toString(), bps: q.tax.rateBps,
                              pair: hmac(q.payerId + ':' + q.receiverId), fy: '2026-27', agg: agg.toString() });
  return { txId, hashscan: `https://hashscan.io/testnet/transaction/${txId}`, hcsSequence: seq };
}
```

HCS messages are public, so they carry an HMAC pair ID, never PAN or names. `agg` is the pair's running total in paise after this payment, and `rph` is the first 8 bytes of the rule-pack hash. With both, anyone can recompute each decision. The message stays under HCS's 1,024-byte limit. The payments topic has a **submit key held by Core**, so nobody else can post to the log. The message is written through an outbox and retried until it succeeds.

Other HCS message types on the same topic: `rulepack` (pack ID and full hash, once per pack), `decision` (from `POST /v1/decide`, with the settlement chain), `outside` and `outside_resolved` (watcher flags and the owner's classification), and `challan` (month, receiver and a hash of the challan reference).

### Data model (PostgreSQL)

| Table | Key columns |
| --- | --- |
| `receivers` | id, legal\_name, pan\_commitment, tan (nullable: specified persons need none), gstin, residency, specified\_person, wallets\[\] (each with a verified ownership signature), mode (threshold or first\_rupee), unverified\_policy (strict or threshold\_tolerant), api\_key\_hash |
| `agents` | id, hcs14\_id (UAID, or CAIP-10 account for Level 0), owner\_ref, level (0, 1, 2), residency, pan\_on\_file, credential\_ref, credential\_issuer, wallets\[\], reserve\_account\_id, verified\_at |
| `quotes` | id, scheme (kosha\_split or exact\_compat), receiver\_id, agent\_id, resource, price\_micro, tds\_micro, total\_micro, rate\_bps, rulepack, fx\_micro, node\_ids\[\], expires\_at, used\_tx\_id |
| `payments` | id, quote\_id, tx\_id, forward\_tx\_id (compat only), consensus\_ts, price\_micro, tds\_micro, reserve\_account\_id, inr\_value\_paise, hcs\_seq, status |
| `aggregates` | (agent\_id, receiver\_id, fy) primary key, value\_paise, payments\_count, outside\_value\_paise |
| `decisions` | id, source (kosha or external), chain, external\_tx\_ref, receiver\_id, agent\_id, decision fields, hcs\_seq |
| `outside_payments` | id, receiver\_id, from\_wallet, tx\_id, value\_paise, shortfall\_paise, classification (pending, consideration, not\_consideration\_gift), note, hcs\_seq |
| `challans` | id, receiver\_id, month, tds\_paise, challan\_ref\_hash, recorded\_at, hcs\_seq |
| `releases` | id, challan\_id, agent\_id, reserve\_account\_id, micro, schedule\_id, status, cosigned\_by |
| `lots` | id, agent\_id, acquired\_ts, micro, cost\_paise, spent\_payment\_id, gain\_paise |
| `policies` | agent\_id, per\_payment\_micro, daily\_micro, fy\_budget\_micro, allowlist\[\], threshold\_action (warn, block, allow) |

**Reserve accounts.** Core creates one per agent at registration: key `KeyList([agentKey, coreKey], 2)`, where the agent's public key comes from the Mirror Node, and `maxAutomaticTokenAssociations: 1`. The first USDC credit therefore associates the account with no agent signature; Core pays that fee as fee payer, inside the `MAX_TX_FEE_HBAR` cap. Bootstrap creates the demo agents' reserves and associates them explicitly, because it holds both keys.

### Jobs

- **Watcher** (every 30 s): for each receiver wallet, `GET /api/v1/transactions?account.id=<wallet>&transactiontype=CRYPTOTRANSFER&timestamp=gt:<cursor>`. A USDC credit whose memo isn't `kosha:*`, from a declared payer wallet, is **flagged**, never withheld. It counts toward the pair's aggregate (to stay safe) until the owner classifies it. If it is consideration and TDS should have applied, Core records a shortfall, emits `outside.payment`, and the Console asks the payer to top up or the receiver to pay it. If the owner marks it "not consideration: gift from a relative" with a note, it leaves the threshold count and the export. Both outcomes are logged to HCS.
- **Monthly close and release** (findings §1.2): on the 1st, Core totals each receiver's TDS by payer for the past month and shows a payment summary (amount, TAN or PAN, month, section). The deductor pays the challan in INR on the income-tax portal and enters the reference in Console; Core logs its hash to HCS. Core then creates one `ScheduleCreateTransaction` per payer reserve: a `TransferTransaction` from the reserve to the deductor (reimbursement), memo `kosha-release:<month>:<agent>`, `setWaitForExpiry(false)`, expiry 7 days out. HIP-423 is live on testnet (`docs/research/scheduled-transactions.md`). Core's signature counts at creation; the agent operator co-signs with `ScheduleSignTransaction`, and the transfer runs on that signature. Treat `IDENTICAL_SCHEDULE_ALREADY_CREATED` as success. In the MVP the INR payment is mocked and labelled as such.
- **HCS outbox** publisher, plus the one-off `rulepack` message when a new pack is loaded.

## Component 2: Kosha Gate (server SDK)

Kosha Gate lets an Indian API owner charge agents with three lines of code. It answers unpaid requests with a 402 quote from Core, verifies and settles paid ones, then lets the request through.

### Usage

```ts
import express from 'express';
import { koshaGate } from '@kosha/gate';

const app = express();
app.use(koshaGate({
  core: 'https://core.kosha.dev',
  apiKey: process.env.KOSHA_API_KEY!,        // identifies the receiver in Core
  routes: {
    'GET /v1/gst-lookup': { priceUsdc: '0.10', description: 'GSTIN lookup' },
    'GET /v1/company/:cin': { priceUsdc: '0.25' },
  },
}));
app.get('/v1/gst-lookup', (req, res) => res.json({ ok: true, paidBy: req.kosha.agentId }));
```

### Request lifecycle

1. A request matches a priced route. With no `PAYMENT-SIGNATURE` header, Gate reads the agent's identity from `X-KOSHA-AGENT`, calls `POST /v1/quote`, and responds **402** with the `PAYMENT-REQUIRED` header (base64 JSON) and the same JSON as the body.
2. With a `PAYMENT-SIGNATURE` header (the legacy `X-PAYMENT` is also read), Gate calls `POST /v1/verify`, then `POST /v1/settle`.
3. **Reserve proof** (`onChainProof`, on by default): Gate reads the settled transaction from the Mirror Node and checks that the reserve leg credited the quoted amount, so it relies on the chain rather than on Core's word. This adds the Mirror Node's few seconds of lag; the burst script turns it off.
4. On success it sets `req.kosha = { agentId, txId, tdsMicroUsdc, hcsSequence }`, adds a `PAYMENT-RESPONSE` header (base64 v2 settlement response, Kosha data in `extensions.kosha`), and calls `next()`.
5. On failure it responds 402 again, with a Kosha `error` code (`amount_mismatch`, `quote_expired`, `replay`, and so on) and `PAYMENT-RESPONSE` set to `success: false`.

Gate uses `@x402/core`'s header codecs and types. If `x402ResourceServer` lets each request supply its own payment requirements (Kosha's quote is per request), Gate is built on it with an `HTTPFacilitatorClient` pointing at Core; otherwise Gate keeps its own flow and uses only the codecs. B04 checks this first.

### Package details

| Item | Detail |
| --- | --- |
| Exports | `koshaGate(options)` for Express, `koshaHono(options)` for Hono, `createGateHandler()` for any framework |
| Options | `core`, `apiKey`, `routes` (net prices), `onSettled(event)`, `settleMode` (`before` the handler runs, the default; or `after` a 2xx response), `onChainProof` |
| Behaviour | Settles before the handler runs, so an agent never gets data without paying |
| Headers | Reads `PAYMENT-SIGNATURE` (and `X-PAYMENT`), `X-KOSHA-AGENT`; writes `PAYMENT-REQUIRED`, `PAYMENT-RESPONSE`, `X-KOSHA-TAX` (rate and amount reserved). CORS exposes the response headers |
| Unknown agent | Still served, under the receiver's unverified-payer policy. The 402 links to Level 1 registration |
| Terms | Serves `GET /.well-known/kosha`: net prices, rule pack, unverified-payer policy, accepted verification levels |
| Dependencies | `@kosha/shared` and the Mirror Node client only (`@kosha/hedera/mirror`, no SDK), so Gate stays light |
| Build | `tsup` to ESM + CJS, types included; around 300 lines plus tests |
| Tests | Supertest against a mocked Core: 402 shape, happy path, every verifier error, replay |

## Component 3: Kosha Pay (agent client library)

Kosha Pay is a drop-in `fetch` that pays 402 responses on its own. It checks the quote against the owner's spending rules, signs exactly the quoted transfers, and retries the request.

### Usage

```ts
import { createKoshaPay } from '@kosha/pay';

const pay = createKoshaPay({
  network: 'testnet',
  accountId: process.env.AGENT_ACCOUNT_ID!,
  privateKey: process.env.AGENT_PRIVATE_KEY!,
  agentId: process.env.AGENT_HCS14_ID!,           // carries the tax credential reference
  policy: { perPaymentUsdc: '0.50', dailyUsdc: '5', fyBudgetUsdc: '200',
            allowlist: ['api.demo-in.dev', 'api.demo-global.dev'], onThreshold: 'warn' },
  reserveAccountId: process.env.AGENT_RESERVE_ID!, // the agent's own TDS reserve (Core returns it at registration)
});

const res = await pay.fetch('https://api.demo-in.dev/v1/gst-lookup?gstin=27AAPFU0939F1ZV');
console.log(await res.json(), pay.lastReceipt);   // { txId, hashscan, tdsMicroUsdc }
```

Pay is an x402 v2 client: it registers a `kosha-split` scheme into `@x402/core`'s `x402Client`, the official extension point for new schemes. Any x402 client can therefore pay Kosha's atomic split by registering the same scheme. Pay also exposes the two steps separately, `pay.prepare(url)` (fetch the 402, check it, sign) and `pay.complete(prepared)` (retry with the payment), so the Agent Kit tool can run a policy check between them.

### Signing the quoted transfer

```ts
import { AccountId, PrivateKey, TokenId, TransactionId, TransferTransaction } from '@hiero-ledger/sdk';

async function signQuote(k: KoshaExtra, feePayer: string, asset: string, me: string, key: PrivateKey) {
  const token = TokenId.fromString(asset);
  let tx = new TransferTransaction()
    .setTransactionId(TransactionId.generate(AccountId.fromString(feePayer)))   // Core pays the fee
    .setNodeAccountIds(k.nodeAccountIds.map((n) => AccountId.fromString(n)))   // several nodes: one busy node can't block settlement
    .setTransactionMemo(k.memo)
    .setMaxTransactionFee(MAX_FEE)
    .addTokenTransfer(token, AccountId.fromString(me), -BigInt(k.totalMicro));
  for (const t of k.transfers) tx = tx.addTokenTransfer(token, AccountId.fromString(t.account), BigInt(t.amount));
  const signed = await tx.freeze().sign(key);                                  // signs the body for every quoted node
  return Buffer.from(signed.toBytes()).toString('base64');                     // payload.transaction
}
```

The SDK accepts `bigint` amounts directly. In the codebase this is `buildQuotedTransfer()` in `@kosha/hedera`, the same function the verifier's tests use.

### Rules applied before every payment

1. The host is on the allowlist.
2. The all-in total (price plus TDS) is within the per-payment, daily and yearly budgets. Tax counts towards budgets.
3. If the quote's `reason` is `threshold_crossed` or `tolerance_exceeded`, apply `onThreshold`: `warn` (log and pay), `block` (refuse), or `allow`.
4. The quote's rule pack is one the owner accepts (`acceptRulepacks: ['in-2026.*']`).
5. The signed transfer list equals the quote's `transfers` exactly, and the `tds_reserve` leg goes to **the agent's own reserve**. Pay never signs anything else.

Core enforces the same policy server-side, so a modified client can't bypass it.

### Agreeing terms before paying

Funding is no longer negotiable: mode C is the only mode. The Hedera bonus for agents negotiating before payment is met by agreeing **verification terms** in a short exchange before the first paid call:

1. Pay reads the API's terms at `GET /.well-known/kosha`: net prices, rule pack, the owner's unverified-payer policy, and accepted verification levels.
2. Pay proposes the level it will pay under (Level 0, or Level 1 with its credential reference) and the rule packs it accepts.
3. The API answers `accept`, with the rate that will apply, or `counter` (for example "strict policy: Level 0 pays 20%; present Level 1 for 1%"). The agreed term is stored in Core for that pair and stamped on every quote.

For a fuller version, run it as an A2A task between the agent and an API-side agent. That's a stretch goal.

### Hedera Agent Kit plugin

`kosha_paid_fetch` is a **`BaseTool`** inside a kit plugin, not a plain tool object. The kit runs policies and hooks only for `BaseTool` subclasses (`hedera-skills`: agent-kit-policy, agent-kit-hook).

```ts
// packages/pay/src/agent-kit-plugin.ts (sketch; match the kit's BaseTool signatures when building)
export class KoshaPaidFetchTool extends BaseTool {
  method = 'kosha_paid_fetch';
  name = 'Kosha paid fetch';
  description = 'Fetch a paid API; pays in USDC on Hedera with Indian TDS reserved';
  parameters = z.object({ url: z.url() });
  constructor(private pay: KoshaPay) { super(); }
  async coreAction({ url }) { return this.pay.prepare(url); }           // 402 → checked, signed payment
  async secondaryAction(prepared) { return this.pay.complete(prepared); } // retry with PAYMENT-SIGNATURE
}

// Blocks between the two steps if the quote breaks the owner's budget
export class KoshaBudgetPolicy extends AbstractPolicy {
  name = 'Kosha budget'; description = 'Per-payment, daily and FY caps including tax';
  relevantTools = ['kosha_paid_fetch'];
  protected shouldBlockPostCoreAction(params) { return !withinBudget(params.coreActionResult.quote); }
}

export const koshaPayPlugin = (pay: KoshaPay): Plugin =>
  ({ name: 'kosha-pay', version: '0.1.0', tools: () => [new KoshaPaidFetchTool(pay)] });
```

The demo agent loads `koshaPayPlugin(pay)` and `coreAccountQueryPlugin` only (no mutation plugins, so the LLM can't move funds outside Kosha's policy). It sets `context.hooks` to `[new KoshaBudgetPolicy(), new HcsAuditTrailHook(...)]` so every paid call is also written to an HCS audit topic by the kit itself. The agent is built with `createAgent` from `langchain` v1, and the LLM is chosen by `LLM_PROVIDER`.

### Registration and verification levels

1. **Level 0** happens automatically: on the first quote for an unknown `X-KOSHA-AGENT` account, Core registers it at Level 0 and creates its reserve account.
2. **Level 1:** create the agent's HCS-14 UAID with `createUaid()` and inscribe an HCS-11 profile whose `properties.kosha` holds the credential issuer, the credential hash and the declared wallet list (never the PAN). Then call `POST /v1/agents` with the UAID and the signed credential. Core resolves the profile, checks the hash and the issuer's signature, and stores residency and PAN-on-file. See `docs/research/hcs-14.md`.
3. **Level 2:** a full KYC credential from a provider (mocked in the MVP).
4. For the demo, Core's own test issuer signs: resident with PAN (Level 1), non-resident with a Tax Residency Certificate (Level 1), and a Level 2 business payer. Specified-person status is now a **receiver** property, so no agent credential carries it.

## Component 4: Kosha Console (web dashboard)

Kosha Console is the only part people look at, and it carries the demo: a live threshold counter, the split on HashScan, and a filing export. It has two workspaces, one for API owners and one for agent owners, plus a read-only view for a CA.

### Screens

| Workspace | Screen | What it shows | Data source |
| --- | --- | --- | --- |
| API owner | Overview | Earnings today and this month, TDS withheld, escrow balance, payments per minute (live) | `GET /v1/ledger`, server-sent events |
| API owner | Payments | Every payment: time, agent, price, TDS, rate, reason, HashScan and HCS links | Ledger + Mirror Node |
| API owner | Counterparties | Each payer's yearly total against its threshold as a progress bar, residency badge, credential status | `aggregates`, `agents` |
| API owner | Tax | Quarter summary, deductee-wise totals, **Download TDS file (CSV)**, rule-pack version and review status | `GET /v1/exports/tds` |
| API owner | Escrow and sweeps | Escrow balance, monthly sweep schedule, **Co-sign sweep** button | `sweeps`, `ScheduleSignTransaction` via WalletConnect |
| API owner | Outside payments | USDC that arrived outside Kosha, shortfall, resolve or request top-up | `outside_payments` |
| API owner | Settings | Thresholds or first-rupee mode, funding mode accepted, priced routes, API keys, webhooks | `receivers` |
| Agent owner | Agents | Each agent's HCS-14 ID, credential, declared wallets, status | `agents` |
| Agent owner | Spend | Spend by API and day, tax paid on top, budget left | Ledger |
| Agent owner | Policies | Caps, allowlist, threshold action, accepted rule packs | `policies` |
| Agent owner | Tax credits and gains | TDS credited to the owner's PAN per deductor, INR value and gain or loss per lot | `GET /v1/payers/:id/report` |
| CA (read-only) | Filing view | Tax screen plus evidence links (HashScan, HCS sequence numbers) | Same as Tax |

### Demo-critical widgets (build these first)

1. **Threshold counter:** a progress bar that fills towards ₹10,000 as payments arrive and turns amber at 90%. At the crossing, the next row shows "1% withheld".
2. **Live payments feed** with HashScan links: judges click one and see the two transfers.
3. **TDS file download**, with the columns of the TDS statement.
4. **Rule-pack badge** reading "in-2026.1 · unreviewed": it shows honestly that the law is configurable and needs a CA.

### Build notes

- App Router routes: `/(owner)/overview`, `/payments`, `/counterparties`, `/tax`, `/escrow`, `/outside`, `/settings`; `/(agent)/agents`, `/spend`, `/policies`, `/credits`.
- Live data through server-sent events from Core (`GET /v1/stream?receiverId=`), falling back to polling every 3 seconds.
- Show amounts in both USDC and ₹, with the FX rate and its timestamp on hover.
- Seed script fills a quarter of realistic history, so screens aren't empty during the demo. Label it "sample data" in the UI.

## Step-by-step code execution

Build in this order: each step ends with something runnable, so the demo works end to end as early as step 7.

### Step 0: Prerequisites

```bash
node -v      # 20.x
corepack enable && pnpm -v
docker -v    # for Postgres and Redis
```

Create a Hedera testnet account at portal.hedera.com (it comes with test HBAR). Look up the testnet USDC token ID in Circle's docs and get test USDC from Circle's faucet.

### Step 1: Scaffold the monorepo

```bash
mkdir kosha && cd kosha && pnpm init
pnpm add -Dw turbo typescript tsup vitest @types/node
mkdir -p apps/{core,console,demo-api-in,demo-api-global,demo-agent} packages/{tax-engine,gate,pay,hedera,shared} rulepacks scripts
pnpm create next-app apps/console --ts --tailwind --app --no-src-dir
pnpm --filter ./packages/hedera add @hashgraph/sdk
pnpm --filter ./apps/core add fastify zod drizzle-orm pg node-cron
pnpm --filter ./apps/demo-agent add hedera-agent-kit @langchain/core @langchain/openai
docker run -d --name kosha-pg -e POSTGRES_PASSWORD=kosha -p 5432:5432 postgres:16
```

### Step 2: Environment

```bash
# .env (root)
HEDERA_NETWORK=testnet
CORE_ACCOUNT_ID=0.0.xxxx          # fee payer + facilitator
CORE_PRIVATE_KEY=302e...
ESCROW_ACCOUNT_ID=                # created in step 3
USDC_TOKEN_ID=0.0.xxxx            # from Circle's docs
HCS_PAYMENTS_TOPIC=               # created in step 3
HCS_PROFILES_TOPIC=
DATABASE_URL=postgres://postgres:kosha@localhost:5432/kosha
PAIR_HMAC_SECRET=<32 random bytes>
FX_SOURCE=demo-fixed
FX_DEMO_INR_PER_USD=88.40
MIRROR_URL=https://testnet.mirrornode.hedera.com
```

### Step 3: Bootstrap Hedera (`scripts/bootstrap.ts`)

1. Create accounts: `receiver-in` (Indian API), `receiver-global`, `agent-resident`, `agent-specified`, `agent-nonresident`, `agent-unknown`, and `escrow` with a 2-of-2 `KeyList` (Core + compliance signer).
2. Associate USDC with every account (`TokenAssociateTransaction`); without this, transfers fail.
3. Fund the four agent accounts with test USDC.
4. Create two HCS topics (`TopicCreateTransaction`): payments log and profile registry. Write the IDs to `.env`.
5. Print a table of account IDs with HashScan links for the README.

```bash
pnpm tsx scripts/bootstrap.ts
```

### Step 4: Tax engine first, tests before anything else

1. Write `packages/tax-engine/src/decide.ts` (Component 1) and load `rulepacks/in-2026.1.json` with Zod validation.
2. Write at least 30 Vitest cases: under, at and over each threshold; crossing with `full` and `excess`; no PAN; unknown payer; non-resident; first-rupee mode; financial-year rollover on 1 April (IST); rounding never under-deducts; tiny prices (1 micro-unit).

```bash
pnpm --filter tax-engine test
```

### Step 5: Hedera package

`packages/hedera` exports `buildClient()`, `verify()`, `settle()`, `hcs.log()`, `mirror.accountKey()`, `mirror.transfersSince()`, and `schedule.sweep()`. Test `verify()` with tampered transactions: an extra transfer, a wrong amount, an HBAR debit of Core, a wrong memo, a replayed ID.

### Step 6: Core server

1. Drizzle schema for the tables in Component 1, then `pnpm drizzle-kit push`.
2. Routes: `/v1/quote`, `/v1/verify`, `/v1/settle`, `/v1/supported`, `/v1/receivers`, `/v1/agents`, `/v1/ledger`, `/v1/stream`.
3. Test credential issuer: signs JSON credentials for the demo agents; verify the signature on `POST /v1/agents`.
4. Seed: one Indian receiver (threshold mode, payer funding), one global receiver.

```bash
pnpm --filter core dev   # http://localhost:4000
```

### Step 7: Gate, demo APIs and Pay: first end-to-end payment

1. Build `@kosha/gate` and mount it in `demo-api-in` (GSTIN lookup, 0.10 USDC) and `demo-api-global` (0.05 USDC).
2. Build `@kosha/pay`; write `scripts/pay-once.ts` that calls `demo-api-in` once.
3. Run it, open the HashScan link, and confirm two token transfers (API and escrow) and one HCS message.

```bash
pnpm --filter demo-api-in dev & pnpm tsx scripts/pay-once.ts
```

**Milestone:** this is the first moment that meets the Hedera track's minimum requirements. Save the transaction ID for the README.

### Step 8: Threshold demo mode

A threshold of ₹10,000 at 0.10 USDC per call takes about 1,100 calls. For the live demo:

1. Seed the pair's aggregate at ₹9,980 (labelled sample history), so the crossing happens within a few calls on stage.
2. Also add `scripts/burst.ts` that sends 20 calls quickly, so the counter visibly moves.

### Step 9: Agent, identity and negotiation

1. Register each demo agent's HCS-14 identity and its `kosha` profile field.
2. Implement `/.well-known/kosha` on the demo APIs and the funding agreement in Pay.
3. Build `demo-agent` on the Hedera Agent Kit with `kosha_paid_fetch`. Prompt: "Find GST details for these 5 companies and summarise."

### Step 10: Console

Build the four demo-critical widgets first (Component 4), then the Tax screen and its CSV export, then everything else.

### Step 11: Watcher and sweep

1. Watcher: send a plain USDC transfer from `agent-resident` to `receiver-in` outside Kosha; it should appear under Outside payments within 30 seconds.
2. Sweep: create the scheduled sweep; co-sign it from the Console; show it executed on HashScan.

### Step 12: Deploy and record

```bash
fly deploy -c apps/core/fly.toml      # or Railway
vercel --cwd apps/console
```

Run the full demo against the deployed stack twice before recording.

### Demo run order (`pnpm demo`)

1. `agent-resident` pays `demo-api-in` while under the threshold: full price, no TDS.
2. Three more calls cross ₹10,000: the counter turns amber, then "1% withheld"; open the split on HashScan.
3. `agent-unknown` pays: 20% from the first rupee, and the 402 body explains how to register.
4. `agent-nonresident` pays `demo-api-global`: no TDS, "FEMA review" flag.
5. `agent-resident` hits its daily cap: payment blocked by policy.
6. An outside transfer appears under Outside payments.
7. Download the TDS file; co-sign the sweep.

## Action plan

The sprint runs in five phases to submission. Gate 2, the first split payment visible on HashScan, is the point where Kosha meets the Hedera track minimum; everything after it adds score.

&#91;embedded content: Sprint plan · 5 phases, 4 gates\]

Don't start a phase until the previous gate passes. If Gate 2 slips past midnight, go straight to the cut list.

### Team roles (three people)

| Role | Owns | Phases |
| --- | --- | --- |
| Hedera and Core | `packages/hedera`, bootstrap script, Core verify and settle, HCS log, watcher, sweep, deploy | 1 to 4 |
| Tax and SDKs | Tax engine and its tests, rule pack, Kosha Gate, Kosha Pay, demo APIs, demo agent, HCS-14 profiles | 1 to 3 |
| Console and story | Kosha Console, seed data, README, architecture diagram, pitch, video | 2 to 5 |

With two people, merge "Tax and SDKs" into the other two roles. Solo, follow the cut list from item 3 onwards.

### Cut list (drop in this order if behind)

1. Agents negotiating funding: hard-code payer-funded.
2. Scheduled sweep: show the escrow balance only.
3. Outside-payment watcher: describe it in the pitch instead.
4. HCS-14 identity: keep credentials in Core only.
5. Gains report for agent owners.
6. Hono adapter for Gate.

**Never cut:** tax engine tests, the split settlement, the HCS log, spending controls, the threshold counter, the 20% default for unknown payers, and the video.

### Submission checklist

- [ ] Public GitHub repo, with this plan's architecture diagram in the README
- [ ] README: setup, architecture, payment flow, and HashScan links for a normal payment, a payment with TDS withheld, and the sweep
- [ ] Demo video around 3:30, in your own voice, which fits both ETHGlobal (2 to 4 min, no AI voiceover) and Hedera (5 min or less)
- [ ] Video shows a settled payment on HashScan and the split
- [ ] Deployed URLs for Core, the demo API and Console
- [ ] Sponsor prizes selected on ETHGlobal (up to 3)
- [ ] "Rule pack unreviewed" and "not tax advice" labels visible in Console and README
- [ ] Seeded history labelled as sample data

## Sponsors, testing, risks and sources

### Sponsor mapping

Hedera's x402 track is the primary target; every requirement and all seven bonuses are covered ([prize page](https://ethglobal.com/events/mumbai/prizes/hedera)).

| Hedera requirement or bonus | Where Kosha meets it |
| --- | --- |
| x402 endpoint settling on Hedera | Kosha Gate + Core, own facilitator |
| Agent pays end to end without human approval | `demo-agent` via Kosha Pay |
| README with settled transaction ID; video of 5 min or less with HashScan | Step 7 milestone; recording in Step 12 |
| Spending controls | Pay policy + server-side enforcement in Core |
| Agent identity (HCS-14) | Agent profiles carry the tax credential reference |
| HCS tamper-evident spending log | Payments topic |
| Agents negotiating before payment | Funding agreement via `/.well-known/kosha` |
| HTS token settlement (USDC) and revenue splits | USDC settlement; price and TDS split in one transfer |
| Scheduled Transactions | Monthly escrow sweep |
| Hedera Agent Kit | `demo-agent` and the `kosha_paid_fetch` tool |

**Also possible:** Hedera's "No Solidity Allowed" ($2,000), since Kosha uses no contracts and at least two native services (HTS, HCS, scheduled transactions). Ask Hedera's team whether one project can win two of their prizes. For the other two sponsor picks, World ID (Agent Pass as proof of a unique human behind each agent) is the closest fit; Arkiv only if records are mirrored there with the required `/arkiv/*.md` files.

### Testing

| Layer | What | Tool |
| --- | --- | --- |
| Tax engine | 30+ cases: thresholds, crossing, rates, residency, financial-year rollover, rounding | Vitest |
| Verifier | Tampered transactions: extra transfer, HBAR debit of Core, wrong token, memo, replay, bad signature | Vitest + SDK fixtures |
| Gate | 402 body, happy path, every error code | Supertest |
| End to end | `pnpm demo` on testnet, asserting HashScan and HCS results | Script |
| Console | Threshold counter, CSV download | Playwright |

### Risks and open questions

- [ ] **Tax reading (highest risk):** does paying for an API in USDC fall under s.393(1), and is the API the deductor? Get a CA's view; until then the rule pack shows "unreviewed".
- [ ] Whole crossing payment or only the excess: confirm with a CA (default `full`).
- [ ] Which INR rate tax law expects for VDA consideration (SBI TT buying rate is common practice).
- [ ] Exact form numbers and due dates under the Income-tax Act 2025.
- [ ] Can a facilitator take on the deduction duty under the exchange-route model?
- [ ] Testnet USDC token ID and faucet availability on Hedera.
- [ ] Whether long-term scheduled transactions (`setWaitForExpiry`) work on testnet.
- [ ] Which x402 version and header names to follow; align with an existing Hedera facilitator's spec.
- [ ] HCS-14 SDK maturity; fall back to an HCS-11 profile if needed.
- [ ] Name clash check for "Kosha" (trademark, npm scope, domain).

### Sources

- [Hedera prizes, ETHGlobal Mumbai](https://ethglobal.com/events/mumbai/prizes/hedera)
- [TDS on Virtual Digital Assets, Section 393(1) (194S), TDSMAN (Aug 2026)](https://blog.tdsman.com/2026/08/tds-on-virtual-digital-assets-section-3931-194s/)
- [CBDT guidelines on TDS for VDAs (Circular 13 of 2022), Khaitan & Co](https://khaitanco.com/thought-leaderships/CBDT-provides-much-awaited-guidelines-in-relation-to-TDS-on-payments-for-Virtual-Digital-Assets)
- [Are stablecoins taxable in India?, KoinX (2026)](https://www.koinx.com/in/tax-guides/are-stablecoins-and-cbdc-taxable-in-india)
- [TDS on crypto in India, ClearTax](https://cleartax.in/s/tds-on-crypto-in-india)
- [On-chain compliance guardrail for agent stablecoin payments, arXiv 2605.00071](https://arxiv.org/abs/2605.00071)

*Not tax or legal advice.*
