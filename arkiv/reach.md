# Reach

## Who it's for

- **AI agents and their developers** looking for paid APIs they can call over x402. The directory
  answers "which APIs will serve me, at what price, and how will my payment be taxed?" before the
  first call.
- **Indian API owners** selling to agents. Mounting Kosha Gate and running `pnpm arkiv:publish`
  makes an API discoverable to every agent, with its tax terms stated up front.
- **Other x402 facilitators**, who can read the same listings to route agents to tax-aware APIs
  without integrating Kosha's server.

## Can they try it today?

Yes, on testnet:

- **The directory:** the Directory section of the Kosha showcase site reads listings live from
  Arkiv in the browser.
- **The query, from a terminal:** `pnpm arkiv:query --level 0` in this repo. It needs no wallet.
- **Publishing:** an API running Kosha Gate can be listed with `pnpm arkiv:publish <api-url>`.

Honest numbers: at submission the directory lists Kosha's two demo APIs (the Indian GSTIN lookup
and the foreign API). No outside API owner has listed yet.

## After Mumbai

- Gate publishes its own listing when it starts, so an API owner needs no separate step.
- Kosha Pay gets a `discover()` call that queries the directory, so an agent can find and pay an
  API in one flow.
- Listings from other registries: readers choose which owner wallets they trust, so a CA firm or
  marketplace can run its own curated list on the same schema.
