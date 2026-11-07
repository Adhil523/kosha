'use client';

import { Section, SectionHead } from '@/components/elements/Section';
import { SECTION_IDS } from '@/lib/constants';
import {
  ARKIV_EXPLORER,
  ARKIV_READ_KEY,
  DIRECTORY_FILTERS,
  type DirectoryFilterKey,
  type DirectoryState,
  filtersFromChoices,
  formatMicroUsdc
} from '@/lib/directory';
import { createArkivReader } from '@kosha/arkiv/arkiv-clients';
import { KOSHA_REGISTRY_OWNER } from '@kosha/arkiv/listing-schema';
import { buildListingQuery, fetchListings, type Listing } from '@kosha/arkiv/query-listings';
import { useEffect, useMemo, useState } from 'react';

// The browser reads Kosha's API listings straight from Arkiv: no wallet, no Kosha server
const reader = createArkivReader(ARKIV_READ_KEY);

const ListingRow = ({ listing }: { listing: Listing }) => (
  <li className="grid gap-2 border-b border-line py-5 md:grid-cols-12 md:items-baseline md:gap-6">
    <span className="md:col-span-5">
      <span className="block font-medium">{listing.description ?? listing.route}</span>
      <span className="block font-mono text-small text-muted">
        {listing.route} · {listing.apiUrl}
      </span>
    </span>
    <span className="font-mono text-small md:col-span-2">
      {formatMicroUsdc(listing.priceMicroUsdc)} USDC
      <span className="block text-muted">net, TDS on top</span>
    </span>
    <span className="font-mono text-small text-muted md:col-span-3">
      {listing.rulepack} · {listing.unverifiedPolicy}
      <span className="block">levels {listing.acceptedLevels.join(', ')}</span>
    </span>
    <span className="md:col-span-2 md:text-right">
      <a
        href={`${ARKIV_EXPLORER}/entity/${listing.entityKey}`}
        target="_blank"
        rel="noreferrer"
        className="link"
      >
        Arkiv entity
      </a>
    </span>
  </li>
);

const FilterSelect = ({
  name,
  value,
  onChange
}: {
  name: DirectoryFilterKey;
  value: string;
  onChange: (value: string) => void;
}) => {
  const filter = DIRECTORY_FILTERS[name];
  return (
    <label className="flex flex-col gap-2 text-label text-muted">
      {filter.label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-line-strong bg-surface px-3 py-2 text-body text-ink"
      >
        {filter.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
};

export const DirectorySection = () => {
  const [choices, setChoices] = useState<Record<DirectoryFilterKey, string>>({
    maxPrice: '',
    level: '',
    policy: ''
  });
  const [state, setState] = useState<DirectoryState>({ status: 'loading' });
  const filters = useMemo(() => filtersFromChoices(choices), [choices]);
  const query = useMemo(
    () => buildListingQuery(reader, KOSHA_REGISTRY_OWNER, filters).toString(),
    [filters]
  );

  useEffect(() => {
    let current = true;
    const load = async () => {
      setState({ status: 'loading' });
      try {
        const listings = await fetchListings(reader, KOSHA_REGISTRY_OWNER, filters);
        if (current) setState({ status: 'ready', listings });
      } catch (error) {
        console.error('[directory]: Arkiv read failed', error);
        if (current) setState({ status: 'error', message: 'Arkiv did not answer. Try again.' });
      }
    };
    void load();
    return () => {
      current = false;
    };
  }, [filters]);

  return (
    <Section id={SECTION_IDS.directory}>
      <SectionHead
        id={SECTION_IDS.directory}
        title="APIs an agent can pay"
        lead="Every Kosha-protected API publishes its terms to Arkiv. This list is read live from Arkiv in your browser, so an agent can find what it may pay without asking Kosha."
      />
      <div className="mt-12 grid gap-4 sm:grid-cols-3">
        {(Object.keys(DIRECTORY_FILTERS) as DirectoryFilterKey[]).map((name) => (
          <FilterSelect
            key={name}
            name={name}
            value={choices[name]}
            onChange={(value) => setChoices((previous) => ({ ...previous, [name]: value }))}
          />
        ))}
      </div>
      <p className="mt-6 font-mono text-ui-meta break-all text-muted">{query}</p>
      {state.status === 'loading' ? <p className="mt-8 text-muted">Reading Arkiv…</p> : null}
      {state.status === 'error' ? <p className="mt-8 text-warning">{state.message}</p> : null}
      {state.status === 'ready' && state.listings.length === 0 ? (
        <p className="mt-8 text-muted">No listed API matches these filters.</p>
      ) : null}
      {state.status === 'ready' && state.listings.length > 0 ? (
        <ol className="mt-8 border-t border-line">
          {state.listings.map((listing) => (
            <ListingRow key={listing.entityKey} listing={listing} />
          ))}
        </ol>
      ) : null}
      <p className="mt-6 text-small text-muted">
        Listings are written by{' '}
        <a
          href={`${ARKIV_EXPLORER}/address/${KOSHA_REGISTRY_OWNER}`}
          target="_blank"
          rel="noreferrer"
          className="link font-mono break-all"
        >
          {KOSHA_REGISTRY_OWNER}
        </a>{' '}
        and expire a week after the API last published its terms.
      </p>
    </Section>
  );
};
