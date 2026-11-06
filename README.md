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
payer, so agents and API owners never need HBAR for fees.

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

| On Hedera                                                                          | Off-chain                                                            |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| x402 payments in USDC, made by agents without human approval                       | The tax engine's calculation (recomputable from HCS)                 |
| One atomic transfer: price to the API, TDS to the agent's reserve                  | Yearly totals per pair (Postgres; each running total is also on HCS) |
| The reserve account, with a 2-of-2 key (agent + Kosha)                             | Taxpayer credentials (KYC issuer)                                    |
| An HCS log of every tax decision, with the rule-pack hash                          | The TDS challan, paid in INR on the government portal                |
| Scheduled transactions for monthly reserve releases (in progress)                  | The quarterly return, filed by a CA                                  |
| Mirror Node reads: Gate's reserve proof, the outside-payment watcher (in progress) |                                                                      |

The money moves on Hedera and the proof lives on Hedera. The only off-chain step is the one the
government requires: paying the tax in rupees.

## Hedera x402 track

| Requirement or bonus                    | Where Kosha meets it                                                                                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| x402 endpoint settling on Hedera        | Kosha Gate and Core, Kosha's own facilitator, x402 v2                                                                                                             |
| Agent pays end to end without approval  | Kosha Pay; the demo agent (in progress)                                                                                                                           |
| Settled transaction ID in the README    | [First settled payment](#first-settled-payment-testnet) below                                                                                                     |
| Spending controls                       | Pay's policy (per payment, daily, yearly budget, allowlist, threshold action); a server-side re-check in Core and an Agent Kit policy (in progress)               |
| Agent identity (HCS-14)                 | Core checks an agent's tax credential against its HCS-14 UAID and HCS-11 profile; demo agent registration in progress                                             |
| HCS tamper-evident log                  | Payments topic whose submit key is Core's, with recomputable decisions                                                                                            |
| Agents negotiating before payment       | Each Gate-protected API publishes its terms (prices, rule pack, unverified-payer policy, accepted levels) at `/.well-known/kosha`; propose-and-counter is planned |
| HTS token settlement and revenue splits | USDC price and TDS split in one `TransferTransaction`                                                                                                             |
| Scheduled transactions                  | Monthly reserve release, co-signed by the agent and Kosha (in progress)                                                                                           |
| Hedera Agent Kit                        | `kosha_paid_fetch` as a `BaseTool` plugin (in progress)                                                                                                           |

Kosha uses no smart contracts, only native HTS, HCS and scheduled transactions.

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

`pnpm demo` will run the whole story and assert each result (in progress):

1. An agent pays the Indian API under the threshold: price only, no TDS.
2. More calls cross ₹10,000: the Console counter turns amber, then "1% reserved".
3. An unverified agent pays within the API owner's tolerance with no tax, then crosses it and pays
   20% until it presents a PAN credential, after which the next quote is 1%.
4. A non-resident agent pays a foreign API: no TDS, flagged for FEMA review.
5. An agent hits its daily cap, and the Agent Kit budget policy blocks the call.
6. A stock x402 client pays through compatibility mode.
7. An outside transfer is flagged and marked as a gift.
8. Download the TDS file, record a mock challan, and co-sign the reserve release.

### Testnet evidence

| What                                                | Link                                                                                                           |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| A payment under the threshold (one leg, no TDS)     | [0.0.11341449@1793987958.456000000](https://hashscan.io/testnet/transaction/0.0.11341449-1793987958-456000000) |
| A payment with 1% TDS reserved (two legs)           | [0.0.11341449@1793987971.680000000](https://hashscan.io/testnet/transaction/0.0.11341449-1793987971-680000000) |
| A reserve release (co-signed scheduled transaction) | Added once the monthly close is built                                                                          |
| Every account and topic                             | [docs/testnet-accounts.md](docs/testnet-accounts.md)                                                           |

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
