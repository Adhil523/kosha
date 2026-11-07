import { createArkivReader } from './arkiv-clients';
import { KOSHA_REGISTRY_OWNER } from './listing-schema';
import { buildListingQuery } from './query-listings';
import { describe, expect, it } from 'vitest';

// Building a query sends nothing; only fetch() reaches the node
const reader = createArkivReader('test-key');
const render = (filters: Parameters<typeof buildListingQuery>[2]) =>
  buildListingQuery(reader, KOSHA_REGISTRY_OWNER, filters).toString();

describe('buildListingQuery', () => {
  it('reads only listings of the Kosha schema that the registry owner wrote', () => {
    const query = render({});
    expect(query).toContain("arkiv.schema = str('kosha.api-listing.v1')");
    expect(query.toLowerCase()).toContain(`$owner = addr(${KOSHA_REGISTRY_OWNER.toLowerCase()})`);
  });

  it('filters by price, verification level, policy, rule pack and network', () => {
    const query = render({
      maxPriceMicroUsdc: 200000n,
      acceptsLevel: 0,
      unverifiedPolicy: 'strict',
      rulepackPrefix: 'in-',
      network: 'hedera:testnet'
    });
    expect(query).toContain('priceMicroUsdc <= u64(200000)');
    expect(query).toContain('acceptsLevel0 = true');
    expect(query).toContain("unverifiedPolicy = str('strict')");
    expect(query).toContain("rulepack STARTSWITH str('in-')");
    expect(query).toContain("network = str('hedera:testnet')");
  });

  it('checks the level the payer asked for, not another', () => {
    expect(render({ acceptsLevel: 2 })).toContain('acceptsLevel2 = true');
    expect(render({ acceptsLevel: 2 })).not.toContain('acceptsLevel0');
  });
});
