# Kosha

**Every agent payment, tax-ready.** Kosha is an x402 payment gateway on Hedera. AI agents pay
Indian APIs in USDC, and Kosha works out the Indian TDS on each payment and withholds it in the
same Hedera transaction.

> **Sample data · rule pack `in-2026.2` unreviewed · not tax advice.** The law here is unsettled.
> Every tax rule lives in a versioned rule pack so a chartered accountant (CA) can review and change
> it without a code change. Testnet only.

## The problem

USDC is a virtual digital asset (VDA) under Indian law. When an agent pays an Indian API in USDC,
the API owner is the buyer of that VDA, and Section 393(1) of the Income-tax Act 2025 (formerly
194S) makes it deduct 1% TDS once the pair's yearly total passes ₹10,000 (₹50,000 for a specified
person), or 20% when the payer has no PAN. No agent-payment tool handles this at payment time, and
getting it wrong costs interest and penalties.

Kosha decides the tax when it quotes, and enforces it when the payment settles. The API gets exactly
its price. The TDS goes to a reserve account the agent owns jointly with Kosha (2-of-2). Every
decision is logged to Hedera Consensus Service (HCS) as evidence.

## Components

| Component         | What it is                                                                                              | Who uses it                        | Code                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| **Kosha Core**    | The facilitator: quotes, verifies and settles x402 payments on Hedera, runs the tax engine, logs to HCS | Runs as a service                  | [`apps/core`](apps/core)                                                |
| **Kosha Gate**    | Server middleware: makes an API endpoint answer 402 and get paid through Kosha                          | Indian API owners                  | [`packages/gate`](packages/gate)                                        |
| **Kosha Pay**     | Agent client: pays Kosha-protected endpoints within the owner's spending rules                          | Agent developers                   | [`packages/pay`](packages/pay)                                          |
| **Kosha Console** | Dashboard: earnings, live payments, threshold progress, TDS ledger                                      | API owners, agent owners, their CA | [`apps/console`](apps/console)                                          |
| Tax engine        | `decide()`: rate, reason and funding for one payment, driven by the rule pack                           | Core                               | [`packages/tax-engine`](packages/tax-engine), [`rulepacks/`](rulepacks) |

## Architecture

```mermaid
flowchart LR
  subgraph Agent side
    AG[AI agent] --> PAY[Kosha Pay]
  end
  subgraph API owner
    GATE[Kosha Gate] --> API[Paid API]
  end
  subgraph Kosha
    CORE[Kosha Core<br/>quote · verify · settle] --> TAX[Tax engine<br/>rule pack in-2026.2]
    CORE --> DB[(Postgres<br/>ledger, yearly totals)]
    CON[Kosha Console] --> CORE
  end
  subgraph Hedera
    HTS[HTS: USDC transfer<br/>price + TDS legs]
    HCS[HCS payments topic<br/>submit key = Core]
    MIR[Mirror Node]
    RES[Agent's 2-of-2 reserve]
  end
  PAY -- "HTTP + x402 v2" --> GATE
  GATE -- "quote, verify, settle" --> CORE
  CORE -- "fee payer" --> HTS
  HTS --> RES
  CORE --> HCS
  GATE -- "reserve proof" --> MIR
```

The agent only talks to the API. The API's Gate talks to Core. Only Core touches Hedera, as the fee
payer, so agents and API owners never need HBAR for fees. Trust boundaries and every check a payment
passes are in [docs/architecture.md](docs/architecture.md).

### One paid request

```mermaid
sequenceDiagram
  participant P as Kosha Pay (agent)
  participant G as Kosha Gate (API)
  participant C as Kosha Core
  participant H as Hedera
  P->>G: GET /v1/gst-lookup (X-KOSHA-AGENT)
  G->>C: POST /v1/quote
  C->>C: profiles, ₹ value, pair's yearly total, decide()
  C-->>G: kosha-split + exact entries
  G-->>P: 402 PAYMENT-REQUIRED
  P->>P: check spending policy and every leg, then sign
  P->>G: retry with PAYMENT-SIGNATURE
  G->>C: POST /v1/verify, POST /v1/settle
  C->>H: one TransferTransaction (price → API, TDS → agent's reserve)
  C->>H: HCS message: amounts, rate, rule-pack hash, pair's running total
  G->>H: Mirror Node: did the reserve leg settle?
  G-->>P: 200 + PAYMENT-RESPONSE (tx ID, HashScan link, TDS reserved)
```

Header and field names follow x402 v2 (`PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`,
`PAYMENT-RESPONSE`, network `hedera:testnet`). Each 402 offers two entries: `kosha-split`, Kosha's
atomic split for Kosha Pay, and `exact`, so a standard x402 client can still pay (compatibility
mode, in progress).

### What's on-chain and what isn't

| On Hedera                                                            | Off-chain                                                            |
| -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| x402 payments in USDC, made by agents without human approval         | The tax engine's calculation (recomputable from HCS)                 |
| One atomic transfer: price to the API, TDS to the agent's reserve    | Yearly totals per pair (Postgres; each running total is also on HCS) |
| The reserve account, with a 2-of-2 key (agent + Kosha)               | Taxpayer credentials (KYC issuer)                                    |
| An HCS log of every tax decision, with the rule-pack hash            | The TDS challan, paid in INR on the government portal                |
| Scheduled transactions for monthly reserve releases                  | The quarterly return, filed by a CA                                  |
| Mirror Node reads: Gate's reserve proof, the outside-payment watcher |                                                                      |

The money moves on Hedera and the proof lives on Hedera. The only off-chain step is the one the
government requires: paying the tax in rupees.

## Hedera x402 track

| Requirement or bonus                    | Where Kosha meets it                                                                                                                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| x402 endpoint settling on Hedera        | Kosha Gate and Core, Kosha's own facilitator, x402 v2                                                                                                                                               |
| Agent pays end to end without approval  | Kosha Pay; the demo agent (in progress)                                                                                                                                                             |
| Settled transaction ID in the README    | [First settled payment](#first-settled-payment-testnet) below                                                                                                                                       |
| Spending controls                       | Pay's policy (per payment, daily, yearly budget, allowlist, threshold action); a server-side re-check in Core and an Agent Kit policy (in progress)                                                 |
| Agent identity (HCS-14)                 | `pnpm register-agents` gives each Level 1 demo agent a UAID and an HCS-11 profile on an HCS-1 topic; Core checks the credential against them ([docs/testnet-accounts.md](docs/testnet-accounts.md)) |
| HCS tamper-evident log                  | Payments topic whose submit key is Core's, with recomputable decisions                                                                                                                              |
| Agents negotiating before payment       | Each Gate-protected API publishes its terms (prices, rule pack, unverified-payer policy, accepted levels) at `/.well-known/kosha`; propose-and-counter is planned                                   |
| HTS token settlement and revenue splits | USDC price and TDS split in one `TransferTransaction`                                                                                                                                               |
| Scheduled transactions                  | Monthly reserve release: Core schedules it after the challan, the agent co-signs from the Console's Reserve screen or `pnpm demo`                                                                   |
| Hedera Agent Kit                        | `kosha_paid_fetch_tool` as a `BaseTool` plugin (in progress)                                                                                                                                        |

Kosha uses no smart contracts, only native HTS, HCS and scheduled transactions.

## Arkiv: a public directory of tax-aware APIs

Every Kosha-protected API publishes its terms at `/.well-known/kosha`: net prices, the tax rule
pack, the unverified-payer policy and the verification levels it serves. Kosha copies those terms
to [Arkiv](https://arkiv.network) as one entity per priced route, so an agent can find an API it
may pay, and see how its payment will be taxed, **without asking Kosha**. The showcase site's
**Directory** section reads the listings live from Arkiv in the browser and filters them.

- **Network:** Arkiv Rabdi testnet, with `@arkiv-network/sdk` 1.0.1
- **Writer wallet:** `0xeA102e83bD920cc72dC70eA18CEcd8A05c8B0604`, which owns every listing
- **Code:** [`packages/arkiv`](packages/arkiv/src), [`scripts/arkiv-publish.ts`](scripts/arkiv-publish.ts),
  [`scripts/arkiv-query.ts`](scripts/arkiv-query.ts) and the site's
  [`DirectorySection`](apps/site/components/sections/DirectorySection.tsx)
- **Docs:** [schema](arkiv/schema.md), [how we use Arkiv](arkiv/how-you-use-arkiv.md),
  [why Arkiv](arkiv/why-arkiv.md), [reach](arkiv/reach.md), [friction](arkiv/friction.md)

One query you can run (it needs no wallet): APIs that serve an unverified (Level 0) payer for at
most 0.20 USDC, cheapest first.

```bash
pnpm install
pnpm arkiv:query --max-usdc 0.2 --level 0
# arkiv.schema = str('kosha.api-listing.v1') AND priceMicroUsdc <= u64(200000)
#   AND acceptsLevel0 = true AND $owner = addr(0xeA102e83bD920cc72dC70eA18CEcd8A05c8B0604)
#   ORDER BY priceMicroUsdc:u64 ASC
```

To list an API: run it with Kosha Gate, set `ARKIV_PRIVATE_KEY` in `.env` (a funded Rabdi wallet),
then `pnpm arkiv:publish http://localhost:4101`. Re-running it refreshes the listings and renews
their 7-day lifetime; `source=listed` (e.g. `http://localhost:4101=https://api.example.com`) reads
the terms locally and lists the public URL.

**Built at ETHGlobal Mumbai.** All of Kosha, including the Arkiv directory, was built at the event
(first commit 6 November 2026). **How we used AI:** the code was written by Claude agents
(Claude Code) working from the team's spec, task queue and reviews; people chose the design,
reviewed and merged every pull request, and ran the testnet steps.

## Why Hedera

1. **Fixed, tiny fees.** Withholding 1% of an ₹8 API call only makes sense when the fee is a
   fraction of a cent and known in advance; a variable gas fee would cost more than the tax.
2. **A native multi-party transfer.** One `TransferTransaction` moves the price to the API and the
   TDS to the agent's reserve atomically, with no smart contract.
3. **HCS as the evidence log.** Every decision is ordered, timestamped and append-only, and the
   submit key means only Kosha can write to the topic. Anyone can recompute a decision from it.
4. **Scheduled transactions.** The 2-of-2 reserve releases through a co-signed scheduled
   transaction, with no custody code.
5. **Agent identity and policy out of the box.** Hedera Agent Kit v4, HCS-14 and HCS-11 give agents
   an identity and policy-enforced spending.

## Network impact

Testnet volume proves nothing, so here is the mechanism. Each unit of use creates Hedera activity:

| Event                                           | Hedera transactions                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| One paid call (`kosha-split`)                   | 1 `CryptoTransfer` + 1 HCS payments message + 1 HCS audit message = **3**                              |
| One paid call (compatibility mode)              | 2 `CryptoTransfer` + 2 HCS messages = **4**                                                            |
| One new agent                                   | 1 reserve `AccountCreate` (plus its own account if Kosha onboards it) + about 3 for its HCS-11 profile |
| One payer and receiver pair, per month          | 1 `ScheduleCreate` + 1 `ScheduleSign` (release) + 1 HCS challan record                                 |
| One tax decision for a payment on another chain | 1 HCS message                                                                                          |

**An illustrative scenario, not a forecast:** 100 API owners × 50 agents each × 200 paid calls a
day is 1,000,000 calls, about 3,000,000 Hedera transactions a day, or **35 TPS** sustained. That is
about 10,000 monthly active accounts (5,000 agents, 5,000 reserves and 100 receivers), and every new
agent creates at least one Hedera account: its reserve.

The audience is mostly new to crypto: Indian API businesses and their CAs, plus every x402
facilitator that asks Kosha for a tax decision.

## Business model

A draft Lean Canvas. Pricing is a proposal, not a decision.

| Block              | Content                                                                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Problem            | Agents pay Indian APIs in USDC; the API owner must deduct 1% TDS on a VDA received in kind; no agent-payment tool handles it, and mistakes cost interest and penalties |
| Customers          | Indian API businesses selling to agents (early adopters: data, GST and KYC APIs); the agent developers who pay them; the CAs who file for both                         |
| Value proposition  | Every agent payment, tax-ready: tax decided and reserved in the same Hedera transaction, with HCS evidence for every row of the return                                 |
| Solution           | Gate (a few lines of middleware), Pay (a drop-in `fetch`), Core (facilitator and tax engine), Console (filing export)                                                  |
| Channels           | x402 and Hedera developer communities, Indian API marketplaces, CA networks, a tax-decision API for other facilitators                                                 |
| Revenue (proposal) | A small per-settlement fee in basis points, or a monthly fee per API owner with filing exports; a per-decision fee for other facilitators                              |
| Costs              | Hedera fees (Core pays them), Mirror Node access, hosting, a KYC provider per verification, a CA review of each rule pack                                              |
| Key metrics        | Paid calls, TDS reserved, receivers onboarded, filings exported, tax decisions served                                                                                  |
| Unfair advantage   | Versioned, CA-reviewed rule packs and an on-chain evidence trail; jurisdiction knowledge others would have to rebuild                                                  |

**Why it needs Web3:** the tax exists only because the payment is a crypto asset, and machine
payments need an atomic, programmable split with public evidence. A card network can't settle a 1%
split of ₹8.84 at this cost.

## Roadmap and go-to-market

- **Roadmap:** a CA-reviewed rule pack → a KYC provider for Level 1 and 2 → Console polish and
  HashPack co-signing → tax decisions for payments on other chains → Kosha as the registered
  deductor → more jurisdictions, each as a rule pack.
- **Go-to-market:** start with Indian data APIs already selling to agents, partner with one CA firm,
  and list Gate in x402 directories.
- **Feedback loops:** a CA review for each rule pack, and the rate at which agents verify after the
  Console warns them they are near the threshold.

## Is the need real?

- The problem is recognised, though only for the US so far:
  [Crypto Briefing (Sep 2026)](https://cryptobriefing.com/ai-agents-crypto-payments-taxable-events/)
  and [Coincub (2026)](https://coincub.com/blog/taxing-agentic-income-ai/) on agents creating
  taxable events.
- India-focused agent-payment guides mention GST but skip TDS:
  [x402 for Indian developers](https://dev.to/umangbuilds/x402-protocol-for-indian-developers-monetize-apis-in-usdc-2026-1jec)
  and
  [AI agent payments in India](https://dev.to/umangbuilds/ai-agent-payments-in-india-the-complete-infrastructure-guide-2026-11am).
- The law says it applies:
  [TDS on VDAs, Section 393(1) (TDSMAN)](https://blog.tdsman.com/2026/08/tds-on-virtual-digital-assets-section-3931-194s/),
  [CBDT Circular 14/2022](https://www.pdicai.org/Docs/circular-14-2022_296202213596419.pdf) and
  [CBDT on P2P VDA transfers (Khaitan & Co)](https://www.khaitanco.com/thought-leaderships/CBDT-clarifies-TDS-mechanism-for-P2P-Peer-to-Peer-VDA-transactions).

We found no system that withholds tax at the moment of an x402 payment.

## Validation

Feedback from people outside the team, recorded as it happens. Planned: a CA reviews rule pack
`in-2026.2`; Indian API owners try the deployed Gate; Hedera's team sees the demo; an outside agent
developer pays with a stock x402 client.

| Date | Who (role) | Channel | What they saw | Feedback             | Change made |
| ---- | ---------- | ------- | ------------- | -------------------- | ----------- |
|      |            |         |               | _None recorded yet._ |             |

## Run it locally

You need Node.js 24, pnpm 10, Docker (for Postgres) and a Hedera testnet account with some HBAR
from [portal.hedera.com](https://portal.hedera.com). Kosha only runs on testnet.

1. **Install.**

   ```bash
   pnpm install
   cp .env.example .env
   ```

2. **Add your operator account.** In `.env`, set `CORE_ACCOUNT_ID` and `CORE_PRIVATE_KEY`. This
   account becomes Kosha Core: the fee payer, and the treasury of the test token.

3. **Start Postgres** and point `DATABASE_URL` in `.env` at it:

   ```bash
   docker run -d --name kosha-pg -e POSTGRES_PASSWORD=kosha -p 5432:5432 postgres:16
   docker exec kosha-pg createdb -U postgres kosha
   # .env: DATABASE_URL=postgres://postgres:kosha@localhost:5432/kosha
   ```

4. **Create the testnet resources.** `pnpm bootstrap` creates a 6-decimal test USDC (`tUSDC`), the
   demo API owners and agents, a 2-of-2 reserve for each agent, and the three HCS topics (each with
   Core as submit key), and generates the secrets. It writes everything into `.env` and is safe to
   run again. `pnpm check-env` lists anything still empty.

   ```bash
   pnpm bootstrap
   ```

5. **Start Core** (port 4000), then register the demo profiles through its admin API:

   ```bash
   pnpm --filter @kosha/core db:migrate
   pnpm --filter @kosha/core dev
   pnpm seed --profiles        # in another terminal
   ```

6. **Start the Indian demo API** (port 4101), a mock GSTIN lookup at 0.10 USDC a call:

   ```bash
   pnpm --filter @kosha/demo-api-in dev
   ```

7. **Pay once.** An agent pays the API through Kosha Pay and prints the receipt and HashScan link:

   ```bash
   pnpm pay-once
   ```

   Below the ₹10,000 threshold the payment has one leg and no TDS. To see the split, cross the
   threshold for the pair first with one large payment, then pay once more:

   ```bash
   pnpm smoke-settle --price 120
   pnpm pay-once
   ```

8. **Open the Console** at <http://localhost:3000>. Pick a workspace on the demo sign-in screen.
   Set `KOSHA_MOCK=1` to browse it on sample data without Core.

   ```bash
   pnpm --filter @kosha/console dev
   ```

### The full demo

`pnpm demo` resets the threshold demo (`seed --reset-demo`), then runs the whole story against
Core and the two demo APIs and asserts each result; a step whose feature was cut prints
`SKIPPED (cut)`. `pnpm burst` fires 20 calls, four in flight, through its own `demo-api-in` with
the reserve proof off (`DEMO_API_PROOF=off`), so the counter visibly moves on stage.

1. An agent pays the Indian API under the threshold: price only, no TDS.
2. More calls cross ₹10,000: the Console counter turns amber, then "1% reserved".
3. An unverified agent pays within the API owner's tolerance with no tax, then crosses it and pays
   20% until it presents a PAN credential, after which the next quote drops to the verified rate
   (0% while the pair is still under ₹10,000, 1% past it).
4. A non-resident agent pays a foreign API: no TDS, flagged for FEMA review.
5. An agent hits its daily cap: Core's server-side policy refuses the quote (`policy_daily`), as
   the Agent Kit budget policy does inside `demo-agent`.
6. A stock x402 client pays through compatibility mode.
7. The agent pays the API directly, outside Kosha: Core's watcher flags the transfer within a
   minute, with the TDS it should have carried, and the owner marks it a gift from a relative.
8. Download the TDS file; record a mock challan for the month, then co-sign the agent's reserve
   release with its own key, and Hedera runs the scheduled transfer to the API owner.

### Testnet evidence

| What                                                | Link                                                                                                           |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| A payment under the threshold (one leg, no TDS)     | [0.0.11341449@1793987958.456000000](https://hashscan.io/testnet/transaction/0.0.11341449-1793987958-456000000) |
| A payment with 1% TDS reserved (two legs)           | [0.0.11341449@1793987971.680000000](https://hashscan.io/testnet/transaction/0.0.11341449-1793987971-680000000) |
| A reserve release (co-signed scheduled transaction) | Added after the first live run of `pnpm demo` step 8                                                           |
| Every account and topic                             | [docs/testnet-accounts.md](docs/testnet-accounts.md)                                                           |

## Deploy

Kosha Core deploys separately; its steps and secrets are in [docs/core-api.md](docs/core-api.md)
(A16). Deploy it first, because the demo APIs and the Console both call it. Everything stays on
testnet.

### Demo APIs (Fly.io)

Each demo API has a Dockerfile and a `fly.toml` (Mumbai region, one machine kept running, a health
check on `/.well-known/kosha`). Run these from the repo root, once per API (`in` and `global`):

```bash
fly auth login
fly apps create kosha-demo-api-in
fly secrets set --config apps/demo-api-in/fly.toml \
  CORE_URL=https://<core-host> DEMO_API_IN_KEY=<from the shared env> CONSOLE_URL=https://<console-host>
fly deploy . --config apps/demo-api-in/fly.toml --dockerfile apps/demo-api-in/Dockerfile \
  --ignorefile apps/demo-api-in/Dockerfile.dockerignore
```

For the foreign API, swap `in` for `global` and `DEMO_API_IN_KEY` for `DEMO_API_GLOBAL_KEY`. To
check the image locally first:
`docker build -f apps/demo-api-in/Dockerfile -t kosha-demo-api-in .`

### Console (Vercel)

1. Import the repository in Vercel and set **Root Directory** to `apps/console`.
   `apps/console/vercel.json` sets the framework and the install and build commands.
2. Add these environment variables. They are all server-only: the browser never sees a Core
   credential.

   | Variable              | Value                                                                    |
   | --------------------- | ------------------------------------------------------------------------ |
   | `CORE_URL`            | The deployed Core's URL                                                  |
   | `CONSOLE_ADMIN_TOKEN` | From the shared env                                                      |
   | `CONSOLE_RECEIVER_ID` | Core's receiver ID for receiver-in: its `receiverId` in `GET /v1/ledger` |
   | `DEMO_AUTH`           | `1` (the workspace picker)                                               |
   | `MIRROR_URL`          | `https://testnet.mirrornode.hedera.com`                                  |
   | `SETTLEMENT_TOKEN_ID` | From the shared env                                                      |
   | `HCS_PAYMENTS_TOPIC`  | From the shared env                                                      |
   | `FX_DEMO_INR_PER_USD` | `88.40` (the rate Core quotes with)                                      |

   Leave `KOSHA_MOCK` unset.

3. Deploy, then set the demo APIs' `CONSOLE_URL` to the Console's URL.

The live feed is a server-sent-events proxy that Vercel closes after 300 seconds. The Console then
polls every 3 seconds until the stream reconnects.

### Check the deployed stack

Pay the deployed Indian API once from your machine, then watch the payment appear in the Console:

```bash
DEMO_API_IN_URL=https://kosha-demo-api-in.fly.dev pnpm pay-once
```

## First settled payment (testnet)

On 6 November 2026 an agent paid the Indian demo API through Kosha Pay (`pnpm pay-once`). The pair
had already crossed the ₹10,000 threshold, so the API received exactly its price, and 1% TDS went
to the agent's own 2-of-2 reserve. Both legs moved in one atomic Hedera transaction.

|                         |                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Transaction             | [`0.0.11341449@1793987971.680000000`](https://hashscan.io/testnet/transaction/0.0.11341449-1793987971-680000000)          |
| Memo                    | `kosha:q_w7813xvnr9jqkt8w140p5nsd`                                                                                        |
| Payer, `agent-resident` | [`0.0.11342842`](https://hashscan.io/testnet/account/0.0.11342842): −0.101019 tUSDC                                       |
| API, `receiver-in`      | [`0.0.11342839`](https://hashscan.io/testnet/account/0.0.11342839): +0.100000 tUSDC (`consideration`)                     |
| Agent's TDS reserve     | [`0.0.11342843`](https://hashscan.io/testnet/account/0.0.11342843): +0.001019 tUSDC (`tds_reserve`)                       |
| Fee payer, Kosha Core   | [`0.0.11341449`](https://hashscan.io/testnet/account/0.0.11341449)                                                        |
| HCS record              | [topic `0.0.11342856`, message #6](https://hashscan.io/testnet/topic/0.0.11342856), with the pair's running total (`agg`) |

The TDS is 1% of ₹8.84, worked out in whole paise and rounded up, so it never under-deducts.
Below the threshold the same call settles with one leg and no TDS
([example](https://hashscan.io/testnet/transaction/0.0.11341449-1793987958-456000000)).
