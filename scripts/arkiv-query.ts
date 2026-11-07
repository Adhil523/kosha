import { createArkivReader } from '@kosha/arkiv/arkiv-clients';
import { KOSHA_REGISTRY_OWNER } from '@kosha/arkiv/listing-schema';
import { buildListingQuery, fetchListings, type ListingFilters } from '@kosha/arkiv/query-listings';
import { loadEnv } from '@kosha/shared/env';
import { formatUsdc } from '@kosha/shared/money';
import { agentLevelSchema, unverifiedPolicySchema } from '@kosha/shared/registry';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { type Hex } from 'viem';

// `pnpm arkiv:query [--max-usdc 0.2] [--level 0] [--policy strict] [--rulepack in-]`: the Kosha
// API directory, read straight from Arkiv. Needs no wallet; ARKIV_ACCESS_KEY is optional.

const USDC_PATTERN = /^\d+(\.\d{1,6})?$/;
const MICRO_PER_USDC = 1_000_000n;

export const usdcToMicro = (usdc: string): bigint => {
  if (!USDC_PATTERN.test(usdc)) throw new RangeError(`"${usdc}" is not a USDC amount`);
  const [whole = '0', fraction = ''] = usdc.split('.');
  return BigInt(whole) * MICRO_PER_USDC + BigInt(fraction.padEnd(6, '0'));
};

export const filtersFromArgs = (args: string[]): ListingFilters => {
  const { values } = parseArgs({
    args,
    options: {
      'max-usdc': { type: 'string' },
      level: { type: 'string' },
      policy: { type: 'string' },
      rulepack: { type: 'string' }
    }
  });
  return {
    ...(values['max-usdc'] ? { maxPriceMicroUsdc: usdcToMicro(values['max-usdc']) } : {}),
    ...(values.level ? { acceptsLevel: agentLevelSchema.parse(Number(values.level)) } : {}),
    ...(values.policy ? { unverifiedPolicy: unverifiedPolicySchema.parse(values.policy) } : {}),
    ...(values.rulepack ? { rulepackPrefix: values.rulepack } : {})
  };
};

const main = async (): Promise<void> => {
  loadEnv();
  const reader = createArkivReader(process.env.ARKIV_ACCESS_KEY ?? '');
  const owner = (process.env.ARKIV_REGISTRY_OWNER ?? KOSHA_REGISTRY_OWNER) as Hex;
  const filters = filtersFromArgs(process.argv.slice(2));

  console.info(`[arkiv-query]: ${buildListingQuery(reader, owner, filters).toString()}`);
  const listings = await fetchListings(reader, owner, filters);
  console.info(`[arkiv-query]: ${listings.length} listing(s)`);
  for (const listing of listings) {
    console.info(
      `[arkiv-query]: ${formatUsdc(listing.priceMicroUsdc).padStart(8)} USDC  ` +
        `${listing.apiUrl} ${listing.route}  ${listing.rulepack}  ${listing.unverifiedPolicy}  ` +
        `levels ${listing.acceptedLevels.join(',')}  ${listing.entityKey}`
    );
  }
};

const isEntryPoint = (): boolean => {
  const entry = process.argv[1];
  return entry !== undefined && realpathSync(entry) === fileURLToPath(import.meta.url);
};

if (isEntryPoint()) {
  main().catch((error: unknown) => {
    console.error('[arkiv-query]: failed', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
