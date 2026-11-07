import { ARKIV_EXPLORER_URL } from '@kosha/arkiv/listing-schema';
import { type Listing, type ListingFilters } from '@kosha/arkiv/query-listings';

export const ARKIV_EXPLORER = ARKIV_EXPLORER_URL;

// An Arkiv access key is not a secret: it ships with any app that reads the chain, and is locked
// to the site's origin. Without one the directory reads Rabdi's public, rate-limited endpoint.
export const ARKIV_READ_KEY = process.env.NEXT_PUBLIC_ARKIV_ACCESS_KEY ?? '';

const MICRO_PER_USDC = 1_000_000n;

export type DirectoryState =
  | { status: 'loading' }
  | { status: 'ready'; listings: Listing[] }
  | { status: 'error'; message: string };

export const DIRECTORY_FILTERS = {
  maxPrice: {
    label: 'Price up to',
    options: [
      { value: '', label: 'Any price' },
      { value: '50000', label: '0.05 USDC' },
      { value: '100000', label: '0.10 USDC' },
      { value: '250000', label: '0.25 USDC' }
    ]
  },
  level: {
    label: 'Serves a payer at',
    options: [
      { value: '', label: 'Any level' },
      { value: '0', label: 'Level 0 (unverified)' },
      { value: '1', label: 'Level 1 (PAN or declaration)' },
      { value: '2', label: 'Level 2 (full KYC)' }
    ]
  },
  policy: {
    label: 'Unverified payers',
    options: [
      { value: '', label: 'Any policy' },
      { value: 'strict', label: 'Strict: 20% from the first rupee' },
      { value: 'threshold_tolerant', label: 'Tolerant up to ₹5,000' }
    ]
  }
} as const;

export type DirectoryFilterKey = keyof typeof DIRECTORY_FILTERS;

// Only values offered in DIRECTORY_FILTERS reach a filter; anything else means "any"
export const filtersFromChoices = (choices: Record<DirectoryFilterKey, string>): ListingFilters => {
  const offered = (key: DirectoryFilterKey) =>
    DIRECTORY_FILTERS[key].options.some((option) => option.value === choices[key]);
  const level = choices.level;
  const policy = choices.policy;
  return {
    ...(choices.maxPrice && offered('maxPrice')
      ? { maxPriceMicroUsdc: BigInt(choices.maxPrice) }
      : {}),
    ...((level === '0' || level === '1' || level === '2') && offered('level')
      ? { acceptsLevel: Number(level) as 0 | 1 | 2 }
      : {}),
    ...((policy === 'strict' || policy === 'threshold_tolerant') && offered('policy')
      ? { unverifiedPolicy: policy }
      : {})
  };
};

// 100000n → "0.10": at least two decimals, trailing zeros past them trimmed
export const formatMicroUsdc = (micro: bigint): string => {
  const whole = micro / MICRO_PER_USDC;
  const fraction = (micro % MICRO_PER_USDC).toString().padStart(6, '0').replace(/0+$/, '');
  return `${whole}.${fraction.padEnd(2, '0')}`;
};
