import { type PlannedListing } from './listing';
import { planPublish } from './publish-listings';
import { describe, expect, it } from 'vitest';

const listing = (route: string): PlannedListing =>
  ({ route, values: { route } }) as unknown as PlannedListing;

describe('planPublish', () => {
  it('creates every listing when Arkiv holds none for the API', () => {
    const plan = planPublish([listing('GET /a'), listing('GET /b')], []);
    expect(plan.creates).toHaveLength(2);
    expect(plan.patches).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it('refreshes a route already listed instead of listing it twice', () => {
    const plan = planPublish([listing('GET /a')], [{ entityKey: '0xaa', route: 'GET /a' }]);
    expect(plan.creates).toEqual([]);
    expect(plan.patches).toEqual([{ entityKey: '0xaa', values: { route: 'GET /a' } }]);
  });

  it('deletes a listing whose route the API no longer prices', () => {
    const plan = planPublish(
      [listing('GET /a')],
      [
        { entityKey: '0xaa', route: 'GET /a' },
        { entityKey: '0xbb', route: 'GET /gone' }
      ]
    );
    expect(plan.deletes).toEqual(['0xbb']);
  });
});
