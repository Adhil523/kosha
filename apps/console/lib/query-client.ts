import { isServer, QueryClient } from '@tanstack/react-query';

let browserClient: QueryClient | undefined;

const makeClient = () => new QueryClient({ defaultOptions: { queries: { staleTime: 1_000 } } });

// One client per browser tab, so non-component code can reach the cache; a fresh one per server
// render, so cached data never crosses requests.
export const getQueryClient = (): QueryClient => {
  if (isServer) return makeClient();
  browserClient ??= makeClient();
  return browserClient;
};

// Shared keys: the live stream writes into these caches, so they live in one place
export const QUERY_KEYS = {
  ledger: ['ledger'],
  aggregates: ['aggregates']
} as const;
