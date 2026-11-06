import { demoResetRequestSchema, samplePaymentsRequestSchema } from './demo-admin';
import { describe, expect, it } from 'vitest';

const SAMPLE = {
  key: 'history:resident:in:1',
  agent: 'hedera:testnet:0.0.6001',
  receiverAccountId: '0.0.5001',
  at: '2026-08-14T09:30:00.000Z',
  priceMicroUsdc: '100000',
  resource: 'https://api.demo-in.dev/v1/gst-lookup'
};

describe('demo admin schemas', () => {
  it('accepts a sample payment and refuses a fractional price', () => {
    expect(samplePaymentsRequestSchema.safeParse({ payments: [SAMPLE] }).success).toBe(true);
    const fractional = { payments: [{ ...SAMPLE, priceMicroUsdc: '0.1' }] };
    expect(samplePaymentsRequestSchema.safeParse(fractional).success).toBe(false);
    expect(samplePaymentsRequestSchema.safeParse({ payments: [] }).success).toBe(false);
  });

  it('accepts the threshold demo reset', () => {
    const reset = {
      balances: [{ agent: SAMPLE.agent, receiverAccountId: '0.0.5001', valuePaise: '998000' }],
      clearAgents: [SAMPLE.agent],
      level0: ['hedera:testnet:0.0.6003']
    };
    expect(demoResetRequestSchema.parse(reset)).toEqual(reset);
  });
});
