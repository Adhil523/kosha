import {
  decideRequestSchema,
  decideResponseSchema,
  facilitatorRequestSchema,
  quoteRequestSchema,
  supportedResponseSchema,
  verifyResponseSchema
} from './facilitator-api';
import { splitEntry } from './x402-payment.fixture';
import { describe, expect, it } from 'vitest';

describe('facilitator API', () => {
  it('parses a quote request with and without an agent identity', () => {
    const base = {
      method: 'GET',
      resource: { url: 'https://api.demo-in.dev/v1/gst-lookup' },
      priceMicroUsdc: '100000'
    };
    expect(quoteRequestSchema.safeParse(base).success).toBe(true);
    expect(
      quoteRequestSchema.safeParse({ ...base, agent: 'hedera:testnet:0.0.6001' }).success
    ).toBe(true);
    expect(quoteRequestSchema.safeParse({ ...base, method: 'get' }).success).toBe(false);
  });

  it('parses a v2 verify request and a failed verification', () => {
    const request = {
      x402Version: 2,
      paymentPayload: { x402Version: 2, accepted: splitEntry, payload: { transaction: 'AAEC' } },
      paymentRequirements: splitEntry
    };
    expect(facilitatorRequestSchema.safeParse(request).success).toBe(true);

    const invalid = {
      isValid: false,
      invalidReason: 'invalid_payload',
      extra: { kosha: { quoteId: 'q_7f3a', errorCode: 'reserve_not_payers' } }
    };
    expect(verifyResponseSchema.safeParse(invalid).success).toBe(true);
  });

  it('parses /v1/supported with both schemes and the rule-pack hash', () => {
    const supported = {
      kinds: ['kosha-split', 'exact'].map((scheme) => ({
        x402Version: 2,
        scheme,
        network: 'hedera:testnet',
        extra: { feePayer: '0.0.4000' }
      })),
      extensions: [],
      signers: { 'hedera:*': ['0.0.4000'] },
      kosha: { rulepack: { id: 'in-2026.2', hash: 'a'.repeat(64), reviewedBy: null } }
    };
    expect(supportedResponseSchema.safeParse(supported).success).toBe(true);
  });

  it('accepts a decision request by identity or by claims', () => {
    const byIdentity = {
      payer: { identity: 'hedera:testnet:0.0.6001' },
      priceMicroUsdc: '100000',
      chain: 'hedera:testnet'
    };
    const byClaims = {
      payer: { claims: { residency: 'resident', panOnFile: true }, reference: 'acct_42' },
      priceMicroUsdc: '100000',
      chain: 'eip155:8453'
    };
    expect(decideRequestSchema.safeParse(byIdentity).success).toBe(true);
    expect(decideRequestSchema.safeParse(byClaims).success).toBe(true);
  });

  it('parses a decision with its HCS sequence still pending', () => {
    const decision = {
      decisionId: 'd_1',
      rulepack: 'in-2026.2',
      rateBps: 100,
      valuePaise: '884',
      tdsPaise: '9',
      tdsMicroUsdc: '1019',
      reason: 'threshold_crossed',
      flags: [],
      hcsSequence: null
    };
    expect(decideResponseSchema.safeParse(decision).success).toBe(true);
  });
});
