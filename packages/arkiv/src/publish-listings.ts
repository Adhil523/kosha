import { type ListingValues, type PlannedListing } from './listing';
import { LISTING_LIFETIME_DAYS, ListingSchema } from './listing-schema';
import { ExpirationTime, type PublicArkivClient, type WalletArkivClient } from '@arkiv-network/sdk';
import { eq } from '@arkiv-network/sdk/query';
import { type Hash, type Hex } from 'viem';

// An API's listings already on Arkiv, owned by the publisher
export type ExistingListing = { entityKey: Hex; route: string };

export type PublishPlan = {
  creates: ListingValues[];
  // Existing listings whose route is still priced: refreshed and their lifetime renewed
  patches: { entityKey: Hex; values: ListingValues }[];
  // Existing listings whose route the API no longer prices
  deletes: Hex[];
};

// Reconciles what the API's terms say with what Arkiv holds, matching listings by route
export const planPublish = (
  desired: PlannedListing[],
  existing: ExistingListing[]
): PublishPlan => {
  const byRoute = new Map(existing.map((listing) => [listing.route, listing.entityKey]));
  const wanted = new Set(desired.map((listing) => listing.route));
  return {
    creates: desired.filter((listing) => !byRoute.has(listing.route)).map((l) => l.values),
    patches: desired.flatMap((listing) => {
      const entityKey = byRoute.get(listing.route);
      return entityKey ? [{ entityKey, values: listing.values }] : [];
    }),
    deletes: existing.filter((listing) => !wanted.has(listing.route)).map((l) => l.entityKey)
  };
};

export type PublishReceipt = {
  // The transaction that created, refreshed and deleted listings
  writeTxHash: Hash | undefined;
  // The transaction that renewed the refreshed listings' lifetime
  renewTxHash: Hash | undefined;
  createdKeys: Hex[];
  patchedKeys: Hex[];
  deletedKeys: Hex[];
};

export const findExistingListings = async (
  publicClient: PublicArkivClient,
  owner: Hex,
  apiUrl: string
): Promise<ExistingListing[]> => {
  const { entities } = await publicClient
    .select({ $key: true, route: true })
    .from(ListingSchema)
    .where(eq('apiUrl', apiUrl))
    .ownedBy(owner)
    .fetch();
  return entities.map((row) => ({ entityKey: row.$key, route: row.route.value }));
};

// Writes one API's listings in at most two transactions: creates, refreshes and deletes together,
// then the renewals (the SDK doesn't say whether one batch may both patch and extend an entity)
export const publishListings = async (
  wallet: WalletArkivClient,
  plan: PublishPlan
): Promise<PublishReceipt> => {
  const expiration = ExpirationTime.fromDays(LISTING_LIFETIME_DAYS);
  const hasWrites = plan.creates.length + plan.patches.length + plan.deletes.length > 0;
  const write = hasWrites
    ? await wallet.executeBatch({
        creates: plan.creates.map((values) => ({ schema: ListingSchema, values, expiration })),
        patches: plan.patches.map(({ entityKey, values }) => ({
          schema: ListingSchema,
          entityKey,
          set: values
        })),
        deletes: plan.deletes.map((entityKey) => ({ entityKey }))
      })
    : undefined;
  const renew =
    plan.patches.length > 0
      ? await wallet.executeBatch({
          extensions: plan.patches.map(({ entityKey }) => ({ entityKey, expiration }))
        })
      : undefined;
  return {
    writeTxHash: write?.txHash,
    renewTxHash: renew?.txHash,
    createdKeys: write?.createdEntities ?? [],
    patchedKeys: write?.patchedEntities ?? [],
    deletedKeys: write?.deletedEntities ?? []
  };
};
