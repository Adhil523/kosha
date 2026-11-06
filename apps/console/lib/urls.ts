// URL builders for Kosha Core. Callers never concatenate paths.
export const URLS = {
  core: {
    supported: (base: string) => new URL('/v1/supported', base).toString()
  },
  hashscan: {
    transaction: (txId: string) => `https://hashscan.io/testnet/transaction/${txId}`
  }
} as const;
