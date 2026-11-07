import { type ListingSchema } from './listing-schema';
import { type CreateEntityValues, u64 } from '@arkiv-network/sdk/schema';
import { agentLevelSchema, unverifiedPolicySchema } from '@kosha/shared/registry';
import { stringToBytes } from 'viem';
import { z } from 'zod';

// An Arkiv str attribute holds at most 128 bytes of UTF-8
const MAX_STR_BYTES = 128;
const ROUTE_PATTERN = /^([A-Z]+) (\/\S*)$/;

// GET /.well-known/kosha, as Kosha Gate serves it (packages/gate/src/kosha-terms.ts). It comes
// from someone else's server, so it is validated before anything is written to Arkiv.
export const koshaTermsSchema = z.object({
  network: z.string().min(1),
  rulepack: z.string().min(1),
  prices: z
    .array(
      z.object({
        route: z.string().regex(ROUTE_PATTERN),
        priceUsdc: z.string().min(1),
        priceMicroUsdc: z.string().regex(/^\d+$/),
        description: z.string().optional()
      })
    )
    .min(1),
  unverifiedPolicy: unverifiedPolicySchema,
  acceptedLevels: z.array(agentLevelSchema),
  registrationUrl: z.string().optional()
});

export type KoshaTerms = z.output<typeof koshaTermsSchema>;
export type ListingValues = CreateEntityValues<typeof ListingSchema>;
// A listing to publish, with its route as plain text for matching against what Arkiv holds
export type PlannedListing = { route: string; values: ListingValues };

const utf8Length = (value: string): number => new TextEncoder().encode(value).length;

// Shortens text to fit a str attribute, never cutting a character in half
const fitText = (value: string): string => {
  let fitted = value;
  while (utf8Length(fitted) > MAX_STR_BYTES) {
    fitted = Array.from(fitted).slice(0, -2).join('') + '…';
  }
  return fitted;
};

// A URL can't be shortened, so one that doesn't fit is left out (the full terms keep it)
const fitUrl = (value: string | undefined): string | undefined =>
  value !== undefined && utf8Length(value) <= MAX_STR_BYTES ? value : undefined;

export const normalizeApiUrl = (apiUrl: string): string => apiUrl.replace(/\/+$/, '');

export type ToListingsResult =
  | { ok: true; data: PlannedListing[] }
  | { ok: false; data: { reason: 'api_url_too_long'; apiUrl: string } };

// One listing per priced route
export const toListings = (apiUrl: string, terms: KoshaTerms): ToListingsResult => {
  const url = normalizeApiUrl(apiUrl);
  if (utf8Length(url) > MAX_STR_BYTES) {
    return { ok: false, data: { reason: 'api_url_too_long', apiUrl: url } };
  }

  const termsBytes = stringToBytes(JSON.stringify(terms));
  const registrationUrl = fitUrl(terms.registrationUrl);
  const listings = terms.prices.map((price): PlannedListing => {
    const method = ROUTE_PATTERN.exec(price.route)?.[1] ?? 'GET';
    const route = fitText(price.route);
    const values: ListingValues = {
      apiUrl: url,
      route,
      method,
      priceMicroUsdc: u64(BigInt(price.priceMicroUsdc)),
      network: fitText(terms.network),
      rulepack: fitText(terms.rulepack),
      unverifiedPolicy: terms.unverifiedPolicy,
      acceptsLevel0: terms.acceptedLevels.includes(0),
      acceptsLevel1: terms.acceptedLevels.includes(1),
      acceptsLevel2: terms.acceptedLevels.includes(2),
      priceUsdc: fitText(price.priceUsdc),
      ...(price.description ? { description: fitText(price.description) } : {}),
      ...(registrationUrl ? { registrationUrl } : {}),
      terms: termsBytes
    };
    return { route, values };
  });
  return { ok: true, data: listings };
};
