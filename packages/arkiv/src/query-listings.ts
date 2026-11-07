import { ListingSchema } from './listing-schema';
import { type PublicArkivClient } from '@arkiv-network/sdk';
import { asc, eq, lte, startsWith } from '@arkiv-network/sdk/query';
import { bool, str, u64 } from '@arkiv-network/sdk/schema';
import { type AgentLevel } from '@kosha/shared/registry';
import { bytesToString, type Hex } from 'viem';

// A page holds at most 100 rows (the node's MAX_LIMIT)
const PAGE_SIZE = 100;

export type ListingFilters = {
  maxPriceMicroUsdc?: bigint;
  // Only APIs that serve a payer at this verification level
  acceptsLevel?: AgentLevel;
  unverifiedPolicy?: 'strict' | 'threshold_tolerant';
  // e.g. "in-" for every Indian rule pack
  rulepackPrefix?: string;
  network?: string;
};

export type Listing = {
  entityKey: Hex;
  apiUrl: string;
  route: string;
  method: string;
  priceUsdc: string;
  priceMicroUsdc: bigint;
  network: string;
  rulepack: string;
  unverifiedPolicy: string;
  acceptedLevels: AgentLevel[];
  description: string | undefined;
  registrationUrl: string | undefined;
  expiresAt: bigint;
};

const LEVEL_ATTRIBUTES = {
  0: 'acceptsLevel0',
  1: 'acceptsLevel1',
  2: 'acceptsLevel2'
} as const;

// The query for a set of filters, chained one where() at a time so the SDK checks each attribute
// against the schema. With no filters it matches every listing the owner wrote.
export const buildListingQuery = (
  publicClient: PublicArkivClient,
  owner: Hex,
  filters: ListingFilters = {}
) => {
  let query = publicClient.select('*').from(ListingSchema).ownedBy(owner);
  if (filters.maxPriceMicroUsdc !== undefined) {
    query = query.where(lte('priceMicroUsdc', u64(filters.maxPriceMicroUsdc)));
  }
  if (filters.acceptsLevel !== undefined) {
    query = query.where(eq(LEVEL_ATTRIBUTES[filters.acceptsLevel], bool(true)));
  }
  if (filters.unverifiedPolicy) {
    query = query.where(eq('unverifiedPolicy', str(filters.unverifiedPolicy)));
  }
  if (filters.rulepackPrefix) {
    query = query.where(startsWith('rulepack', str(filters.rulepackPrefix)));
  }
  if (filters.network) {
    query = query.where(eq('network', str(filters.network)));
  }
  return query.orderBy(asc('priceMicroUsdc')).limit(PAGE_SIZE);
};

export const fetchListings = async (
  publicClient: PublicArkivClient,
  owner: Hex,
  filters: ListingFilters = {}
): Promise<Listing[]> => {
  const { entities } = await buildListingQuery(publicClient, owner, filters).fetch();
  return entities.map((row): Listing => ({
    entityKey: row.$key,
    apiUrl: row.apiUrl.value,
    route: row.route.value,
    method: row.method.value,
    priceUsdc: row.priceUsdc.value,
    priceMicroUsdc: row.priceMicroUsdc.value,
    network: row.network.value,
    rulepack: row.rulepack.value,
    unverifiedPolicy: row.unverifiedPolicy.value,
    acceptedLevels: ([0, 1, 2] as const).filter((level) => row[LEVEL_ATTRIBUTES[level]].value),
    description: row.description?.value,
    registrationUrl: row.registrationUrl?.value,
    expiresAt: row.$expiresAt
  }));
};

// The terms document a listing carries, for a reader that wants every field
export const readListingTerms = (termsBytes: Uint8Array): unknown =>
  JSON.parse(bytesToString(termsBytes));
