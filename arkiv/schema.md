# Arkiv schema: Kosha API listings

Kosha keeps one Arkiv entity per priced route of every Kosha-protected API. It is the public,
queryable copy of the terms each API serves at `/.well-known/kosha`: what it charges, which tax rule
pack its owner applies, and which payers it will serve. An agent filters these entities to find an
API it may pay **before** it calls it.

- **Network:** Arkiv Rabdi testnet (chain ID 7794095)
- **SDK:** `@arkiv-network/sdk` 1.0.1
- **Code:** [`packages/arkiv/src/listing-schema.ts`](../packages/arkiv/src/listing-schema.ts)

## Entity: `kosha.api-listing.v1`

| Attribute                   | Type          | Indexed | Holds                                                                            |
| --------------------------- | ------------- | ------- | -------------------------------------------------------------------------------- |
| `apiUrl`                    | str           | yes     | Where an agent calls the API, without a trailing slash                           |
| `route`                     | str           | yes     | Gate's route key, e.g. `GET /v1/gst-lookup`                                      |
| `method`                    | str           | yes     | The HTTP method of the route                                                     |
| `priceMicroUsdc`            | u64           | yes     | The API's **net** price in micro-USDC; any TDS is added on top for the payer     |
| `network`                   | str           | yes     | The x402 network the payment settles on, e.g. `hedera:testnet`                   |
| `rulepack`                  | str           | yes     | The tax rule pack the owner's Core applies, e.g. `in-2026.2`                     |
| `unverifiedPolicy`          | str           | yes     | How a payer with no verified profile is priced: `strict` or `threshold_tolerant` |
| `acceptsLevel0` / `1` / `2` | bool          | yes     | Whether the API serves a payer at that verification level                        |
| `priceUsdc`                 | str           | no      | The price as the owner wrote it, e.g. `0.10`                                     |
| `description`               | str, optional | no      | The route's description, shortened to 128 bytes if needed                        |
| `registrationUrl`           | str, optional | no      | Where an unverified payer registers for Level 1; left out if over 128 bytes      |
| `terms`                     | bytes         | no      | The API's full `/.well-known/kosha` document as JSON                             |

## Queried fields

The directory and `pnpm arkiv:query` filter on `priceMicroUsdc` (`<=`), `acceptsLevel0/1/2`
(`= true`), `unverifiedPolicy` (`=`), `rulepack` (`STARTSWITH`, e.g. `in-` for every Indian pack)
and `network` (`=`), always together with `$owner` and the schema tag, and sort by
`priceMicroUsdc` ascending. Publishing looks up an API's existing listings by `apiUrl` and
`$owner`.

## Owner

Every listing is written and owned by Kosha's registry wallet
**`0xeA102e83bD920cc72dC70eA18CEcd8A05c8B0604`**. Anyone can write entities that use this schema
name, so readers trust only the ones this address owns: every query adds
`$owner = addr(0xeA10…0604)`. Only the owner can patch, renew or delete a listing.

## Expiration

A listing lives **7 days**. `pnpm arkiv:publish` re-reads each API's terms, refreshes its listings
and renews them for another 7 days. It also deletes listings for routes the API no longer prices.
An API that stops publishing its terms drops out of the directory within a week, with nobody
having to clean up.
