# Arkiv friction log

What got in the way while adding Arkiv to Kosha at ETHGlobal Mumbai, with
`@arkiv-network/sdk` 1.0.1 on Rabdi.

1. **An outdated quickstart still ranks first in search.**
   `arkiv-network.github.io/documentation/overview/quickstart_ts` uses `golem-base-sdk`, the Kaolin
   testnet on Holesky, an encrypted-JSON wallet and `createEntities` / `Annotation`. None of it
   matches the current SDK. A redirect or a banner pointing to `docs.arkiv.network` would save
   people an hour. _To reproduce:_ search "Arkiv TypeScript quickstart".

2. **`where()` rejects an array of filters built ahead of time.** Building
   `const filters: Expression[] = [...]` and calling `.from(Schema).where(...filters)` fails to
   typecheck (`Index signature for type '"${string}" is not a column of this schema' is missing`).
   The schema check needs each expression's literal attribute name, so we chained one `where()`
   per filter instead. Optional filters are common, so a typed helper or a documented pattern for
   them would help. _To reproduce:_ the commit history of
   `packages/arkiv/src/query-listings.ts`.

3. **The faucet is browser-only.** An agent or CI job can generate a wallet but can't fund it, so
   the first write waits on a person. An API, or a faucet that takes an access key, would let a
   repo's setup script finish by itself.

4. **No stated price for a write.** The docs say "you pay for the lifetime you choose", but give no
   formula or per-entity figure, so we couldn't say up front what renewing the directory weekly
   costs.

5. **Batch rules for the same entity aren't documented.** It isn't stated whether one batch may
   both patch and extend the same entity, so the publisher sends renewals in a second transaction
   to be safe.

6. **128-byte strings.** Route descriptions and registration URLs can exceed a str attribute. We
   shorten descriptions, leave out long URLs, and keep the full terms in the bytes payload. A
   longer non-indexed string type would remove that workaround.

7. **The 182-day lifetime cap.** It fits our weekly listings, but rules out Arkiv for Kosha's tax
   evidence, which has to be kept for years. A documented pattern for long-lived data (automatic
   renewal, or a cost per year) would widen what Arkiv can hold.

## What worked well

- Schema-typed reads: `select('*').from(Schema)` gives fully typed rows, and `toString()` prints
  the exact query, which we show on the site.
- `ExpirationTime.fromDays()` and the 2-second blocks made the expiry model easy to reason about.
- Reads from the browser need no wallet, which is what makes a public directory possible.
