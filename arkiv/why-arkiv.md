# Why Arkiv

## What users would lose if the listings lived in Kosha's Postgres

1. **Discovery without permission.** Today an agent can find a tax-aware API it may pay, at a price
   it accepts, without an API key, an account or a request to Kosha. With Postgres it would have
   to call a Kosha endpoint, and Kosha could rank, hide or rate-limit APIs at will. On Arkiv the
   query runs against a public node, and the site does it straight from the browser.
2. **One source other facilitators can read.** Kosha's tax engine is meant for other x402
   facilitators too (`POST /v1/decide`). A directory they can query directly, without trusting or
   integrating Kosha's server, is what lets them route agents to tax-aware APIs.
3. **A clear writer.** Each listing carries its owner wallet. A reader checks that Kosha's registry
   wallet wrote it, without asking us. In Postgres that claim is only our word.
4. **Freshness by default.** A listing expires a week after the API last published its terms.
   A dead API drops out on its own, which Postgres would need a cron job and our honesty to match.

## What we kept off Arkiv, and why

| Kept off Arkiv                                    | Where it lives                                    | Why                                                                                       |
| ------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| The payment itself (USDC, price and TDS legs)     | Hedera, one atomic `TransferTransaction`          | Money moves where it settles. Arkiv stores data, not USDC                                 |
| The tax evidence for each payment                 | Hedera Consensus Service, submit key held by Core | It must stay ordered and append-only for years; HCS gives that, and Arkiv entities expire |
| PANs, names, credentials, yearly totals per payer | Postgres, PAN only as a salted commitment         | Private tax data. Arkiv is public, so nothing personal goes there                         |
| Quotes (120-second lifetime)                      | Postgres                                          | They sit in the middle of every payment; a 2-second block per quote would slow each call  |

Arkiv holds the one thing that is public by nature and changes over time: **what each API charges
and whom it serves.**
