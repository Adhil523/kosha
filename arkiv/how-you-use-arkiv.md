# How Kosha uses Arkiv

| Arkiv feature                        | How Kosha uses it                                                                                                                 | What users see because of it                                                                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Filters on indexed attributes**    | Price (`priceMicroUsdc <= …`), verification level (`acceptsLevel0 = true`), unverified-payer policy, rule-pack prefix and network | The directory's three filters on the site, and `pnpm arkiv:query --max-usdc 0.2 --level 0`. An unverified agent sees only APIs that will serve it, and at what policy |
| **Sorting**                          | `ORDER BY priceMicroUsdc:u64 ASC`                                                                                                 | Cheapest API first                                                                                                                                                    |
| **Owner wallet and edit permission** | Kosha's registry wallet owns every listing; every query adds `$owner = addr(…)`                                                   | The directory shows only listings Kosha wrote, so a stranger can't slip a fake API in using the same schema name. Only Kosha can refresh or remove a listing          |
| **Expiration**                       | 7-day lifetime, renewed by each `pnpm arkiv:publish`                                                                              | An API that stops publishing its terms disappears from the directory within a week                                                                                    |
| **Patch and delete**                 | A re-run patches a listing whose price or policy changed, and deletes listings for routes no longer priced                        | A price change shows up after the next publish, without duplicate rows                                                                                                |
| **Batches**                          | One transaction for an API's creates, patches and deletes; a second for its renewals                                              | Publishing an API costs at most two transactions, whatever its route count                                                                                            |
| **Bytes payload**                    | The full `/.well-known/kosha` JSON on each listing                                                                                | A reader gets every term (e.g. the Level 1 registration link) without calling the API                                                                                 |
| **Public reads, no wallet**          | The site builds a read-only client in the browser                                                                                 | The directory works for any visitor, with no wallet and no Kosha server in between                                                                                    |

## The flow

1. An API owner mounts Kosha Gate, which serves the API's terms at `/.well-known/kosha`.
2. `pnpm arkiv:publish <api-url>` reads those terms, validates them, and writes or renews one
   listing per priced route ([`scripts/arkiv-publish.ts`](../scripts/arkiv-publish.ts)).
3. The site's **Directory** section, and `pnpm arkiv:query`, read the listings back from Arkiv
   ([`apps/site/components/sections/DirectorySection.tsx`](../apps/site/components/sections/DirectorySection.tsx),
   [`scripts/arkiv-query.ts`](../scripts/arkiv-query.ts)).
4. An agent picks an API, then pays it through x402 on Hedera with Kosha Pay, with the TDS reserved
   in the same transaction.
