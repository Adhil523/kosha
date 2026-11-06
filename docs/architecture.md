# Kosha architecture

How the parts fit, who trusts whom, and every check a payment passes on its way to Hedera. The
product spec is [Kosha Execution Plan.md](../Kosha%20Execution%20Plan.md); the wire contracts are in
[`packages/shared`](../packages/shared/src) and Core's HTTP API in [core-api.md](core-api.md).

## Components

| Package                                             | Role                                                                                                            | Talks to                      |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| [`packages/pay`](../packages/pay/src)               | Agent client. Pays a 402 within the owner's spending policy, signs only the quoted transfer                     | The API (HTTP)                |
| [`packages/gate`](../packages/gate/src)             | API middleware. Answers 402 with Core's quote, then verifies, settles and proves the reserve leg before serving | Core (HTTP), Mirror Node      |
| [`apps/core`](../apps/core/src)                     | Facilitator. Quotes, verifies and settles; owns the ledger, the yearly totals and the HCS log                   | Postgres, Hedera, Mirror Node |
| [`packages/tax-engine`](../packages/tax-engine/src) | Pure `decide()` and `applyFunding()`, driven by a rule pack. No I/O                                             | Nothing                       |
| [`packages/hedera`](../packages/hedera/src)         | Builds and verifies the quoted transfer; Mirror, HCS, schedule and reserve helpers                              | Hedera, Mirror Node           |
| [`packages/shared`](../packages/shared/src)         | Zod schemas for every wire format, header names, error codes, money and ID types                                | Nothing                       |
| [`apps/console`](../apps/console)                   | Dashboard. Calls Core only from Next.js server code; the browser never sees a Core credential                   | Core (server side)            |

Internal packages export TypeScript source by subpath (`@kosha/hedera/mirror`), so Gate can read the
Mirror Node without pulling in the Hedera SDK. Gate and Pay build with `tsup` for npm, bundling the
internal packages.

## Trust boundaries

Core is the fee payer for every settlement, so it is the party a dishonest client would try to
exploit. Pay is the agent's last line of defence against a dishonest API or facilitator. Gate trusts
Core for the quote, but not for the claim that the tax was reserved.

| Boundary       | Risk                                                                         | What stops it                                                                                    |
| -------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Agent → API    | The API asks for more than its price, or routes the TDS somewhere else       | Pay's checks before signing (below) and the owner's spending policy                              |
| Agent → Core   | A signed transaction that debits Core, moves HBAR, or differs from the quote | Core's verifier (below), run before Core adds its fee-payer signature                            |
| API → Core     | Someone quotes or settles in another API owner's name                        | Each receiver has its own API key, and Core quotes `payTo` from that receiver's onboarded wallet |
| Core → API     | Core reports success, but the TDS never reached the reserve                  | Gate's reserve proof reads the transaction from the Mirror Node itself                           |
| Anyone → HCS   | Fake entries in the evidence log                                             | Every Kosha topic has Core's key as its submit key                                               |
| Browser → Core | Console users reach Core directly                                            | Core is called only from Next.js server code, with `CONSOLE_ADMIN_TOKEN`                         |

Private data stays off-chain: no PAN and no counterparty names reach HCS. A pair of payer and
receiver appears there only as an HMAC (`pair`), and a PAN only as a salted commitment in Postgres.

## The checks, hop by hop

### 1. Pay, before signing ([`kosha-split-scheme.ts`](../packages/pay/src/kosha-split-scheme.ts))

Pay picks the `kosha-split` entry from the 402 and refuses to sign unless all of these hold:

- the network and the token are the ones this agent pays in;
- the fee payer is in `trustedFacilitators`;
- the quote is self-consistent: exactly one `consideration` leg to `payTo` for `amount`, at most
  one `tds_reserve` leg for the quoted TDS, the legs sum to `totalMicro`, no zero or duplicate
  legs, and the memo is `kosha:<quoteId>`;
- the `tds_reserve` leg credits **this agent's own reserve** and nothing else;
- the quote hasn't expired;
- the spending policy allows the all-in total (per payment, daily, yearly budget, host allowlist,
  accepted rule packs, and what to do when withholding starts).

It then builds exactly the quoted transfer, signed for each quoted node, and retries the request
once with `PAYMENT-SIGNATURE`.

### 2. Core's verifier ([`transfer-verifier.ts`](../packages/hedera/src/transfer-verifier.ts))

A pure function in `@kosha/hedera`. Each failure has its own code in
[`error-codes.ts`](../packages/shared/src/error-codes.ts):

| Check                                                            | Code                                                 |
| ---------------------------------------------------------------- | ---------------------------------------------------- |
| It is a `TransferTransaction`                                    | `not_transfer`                                       |
| Core is the transaction's payer (fee payer)                      | `wrong_fee_payer`                                    |
| The memo is `kosha:<quoteId>`                                    | `memo_mismatch`                                      |
| It is signed for exactly the quoted nodes, with identical bodies | `wrong_nodes`                                        |
| The fee cap is at most `MAX_TX_FEE_HBAR`                         | `fee_too_high`                                       |
| The valid start is inside the quote window                       | `valid_start_out_of_window`                          |
| No HBAR, NFT or allowance (approved) transfers                   | `hbar_movement`, `nft_transfer`, `approved_transfer` |
| One token, and it is the settlement token                        | `token_count`, `wrong_token`                         |
| One debit: the payer, for the all-in total                       | `multiple_debits`, `amount_mismatch`                 |
| Exactly the quoted credits, nothing more                         | `transfer_count`, `amount_mismatch`                  |
| The TDS goes to the reserve registered to this agent             | `reserve_not_payers`                                 |
| The payer's key (from the Mirror Node) signed it                 | `bad_signature`                                      |

Around the pure verifier, Core checks what needs the database: the quote exists and hasn't expired
(`quote_not_found`, `quote_expired`), and neither the quote nor the transaction ID was used before
(`replay`). For a registered agent, the payer must be one of its declared wallets
(`payer_not_declared`).

### 3. Core's settler

Core adds its signature and submits the transaction once.

- If the receipt times out, Core asks the Mirror Node whether the transaction reached consensus
  ([`reconcile.ts`](../apps/core/src/reconcile.ts)). It **never resubmits**: an unknown outcome
  is reported as `settlement_pending`.
- On success, the ledger row, the pair's new yearly total and an HCS outbox row are written in one
  database transaction ([`hcs-outbox.ts`](../apps/core/src/hcs-outbox.ts)). A publisher submits
  each outbox row until it has a sequence number, so a slow HCS write never loses evidence or
  blocks the payment.

### 4. Gate, before serving ([`reserve-proof.ts`](../packages/gate/src/reserve-proof.ts))

Gate reads the settled transaction from the Mirror Node, polling briefly for its lag, and checks
that each `tds_reserve` account was credited at least the quoted amount. Only then does it serve the
data, with `PAYMENT-RESPONSE` carrying the transaction ID, the HashScan link and the TDS reserved.
This is the real-time "proof before release" that a monthly challan can't give. It is on by
default; an API owner can turn it off with `onChainProof: false`.

## Deciding the tax

`decide()` takes the receiver (residency, specified person or not, unverified-payer policy, mode),
the payer (residency, and whether a verified PAN is on file), the price in paise, and the pair's yearly
total. That total counts settled payments, flagged outside payments, and the pair's **open quotes**,
so two quotes issued at once can't both slip under the threshold. It returns a rate in basis points,
a reason (`under_threshold`, `threshold_crossed`, `first_rupee`, `within_tolerance`,
`tolerance_exceeded`, `non_resident`, `receiver_non_resident`) and the TDS in paise, rounded **up**. Core converts that to USDC
micro-units, rounding up again, and `applyFunding()` adds it on top of the price (mode C). The API
always gets exactly its price.

The thresholds, rates, crossing behaviour and policies live in
[`rulepacks/in-2026.2.json`](../rulepacks/in-2026.2.json). Every decision records the pack's
version, and its hash goes to HCS.

## What one HCS message holds

Each settled payment publishes one message to the payments topic, for example:

```json
{
  "t": "pay",
  "v": 2,
  "fy": "2026-27",
  "rp": "in-2026.2",
  "rph": "96cba86985f77eab",
  "tx": "0.0.11341449@1793987971.680000000",
  "pid": "ht0ovpwtv14boirmqxbhp332",
  "pair": "4b0d7c98927b7f522ab88cb7845a00ef",
  "price": "100000",
  "tds": "1019",
  "bps": 100,
  "agg": "1062568"
}
```

| Field             | Meaning                                                     |
| ----------------- | ----------------------------------------------------------- |
| `fy`, `rp`, `rph` | Financial year, rule-pack version and the start of its hash |
| `tx`, `pid`       | Hedera transaction ID and Kosha's payment ID                |
| `pair`            | HMAC of the payer and receiver: stable, but not reversible  |
| `price`, `tds`    | Micro-USDC to the API and to the agent's reserve            |
| `bps`             | The rate applied                                            |
| `agg`             | The pair's running yearly total in paise after this payment |

With `agg`, the rule pack and the price, anyone can recompute whether each decision was right.

## Money

All amounts are integers in minor units (`bigint` micro-USDC and paise), sent over the wire as
decimal strings. Nothing is ever a float. Every conversion from rupees to USDC rounds up, so Kosha
never under-deducts.
