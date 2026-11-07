import { bool, bytes, defineSchema, str, u64 } from '@arkiv-network/sdk/schema';

// One entity per priced route of a Kosha-protected API: the public, queryable copy of what the API
// serves at /.well-known/kosha. An agent filters these to find an API it may pay before calling it.
export const LISTING_SCHEMA_NAME = 'kosha.api-listing.v1';

// A listing lives a week unless `pnpm arkiv:publish` renews it, so an API that stops publishing
// its terms drops out of the directory on its own
export const LISTING_LIFETIME_DAYS = 7;

// The wallet that writes Kosha's listings. Anyone can write entities with this schema name, so
// readers trust only the ones this address owns.
export const KOSHA_REGISTRY_OWNER = '0xeA102e83bD920cc72dC70eA18CEcd8A05c8B0604';

export const ARKIV_EXPLORER_URL = 'https://rabdi.explorer.arkiv.network';

export const ListingSchema = defineSchema(LISTING_SCHEMA_NAME, {
  // Where an agent calls the API, without a trailing slash
  apiUrl: str().indexed(),
  // Gate's route key, e.g. "GET /v1/gst-lookup"
  route: str().indexed(),
  method: str().indexed(),
  // The API's net price; any TDS is added on top for the payer
  priceMicroUsdc: u64().indexed(),
  // The x402 network the payment settles on, e.g. "hedera:testnet"
  network: str().indexed(),
  // The rule pack the API owner's Core applies, e.g. "in-2026.2"
  rulepack: str().indexed(),
  // How the owner prices a payer with no verified profile: strict or threshold_tolerant
  unverifiedPolicy: str().indexed(),
  acceptsLevel0: bool().indexed(),
  acceptsLevel1: bool().indexed(),
  acceptsLevel2: bool().indexed(),
  priceUsdc: str(),
  description: str().optional(),
  registrationUrl: str().optional(),
  // The API's full terms document as JSON, so a reader gets every field without a second request
  terms: bytes()
});
