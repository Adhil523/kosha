const coreUrl = (base: string, path: string, query: Record<string, string> = {}) => {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
};

// URL builders for Kosha Core and the Console's own route handlers. Callers never concatenate paths.
export const URLS = {
  core: {
    supported: (base: string) => coreUrl(base, '/v1/supported'),
    ledger: (base: string, query: Record<string, string>) => coreUrl(base, '/v1/ledger', query),
    aggregates: (base: string, receiverId: string) =>
      coreUrl(base, '/v1/aggregates', { receiverId }),
    stream: (base: string, receiverId: string) => coreUrl(base, '/v1/stream', { receiverId })
  },
  // Browser-facing: the route handlers that call Core with the admin token
  console: {
    ledger: '/api/ledger',
    aggregates: '/api/aggregates',
    stream: '/api/stream'
  },
  hashscan: {
    transaction: (txId: string) => `https://hashscan.io/testnet/transaction/${txId}`
  }
} as const;
