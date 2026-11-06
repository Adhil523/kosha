// The spec's worked example: 0.10 USDC to the API, 1019 micro-USDC TDS to the agent's reserve.
// Plain JSON inputs, as they arrive on the wire.
export const splitEntry = {
  scheme: 'kosha-split',
  network: 'hedera:testnet',
  asset: '0.0.429274',
  payTo: '0.0.5001',
  amount: '100000',
  maxTimeoutSeconds: 120,
  extra: {
    feePayer: '0.0.4000',
    kosha: {
      quoteId: 'q_7f3a',
      memo: 'kosha:q_7f3a',
      expiresAt: '2026-11-06T10:32:00Z',
      nodeAccountIds: ['0.0.3', '0.0.4', '0.0.5'],
      totalMicro: '101019',
      transfers: [
        { account: '0.0.5001', amount: '100000', leg: 'consideration' },
        { account: '0.0.6101', amount: '1019', leg: 'tds_reserve' }
      ],
      tax: {
        rulepack: 'in-2026.2',
        rateBps: 100,
        inrValuePaise: '884',
        tdsMicroUsdc: '1019',
        funding: 'payer_reserve',
        reason: 'threshold_crossed',
        flags: []
      }
    }
  }
};

export const exactEntry = {
  scheme: 'exact',
  network: 'hedera:testnet',
  asset: '0.0.429274',
  payTo: '0.0.4200',
  amount: '101019',
  maxTimeoutSeconds: 120,
  extra: { feePayer: '0.0.4000', kosha: { quoteId: 'q_7f3b', mode: 'compat' } }
};

export const paymentRequired = {
  x402Version: 2,
  error: 'PAYMENT-SIGNATURE header is required',
  resource: { url: 'https://api.demo-in.dev/v1/gst-lookup', description: 'GSTIN lookup' },
  accepts: [splitEntry, exactEntry]
};
