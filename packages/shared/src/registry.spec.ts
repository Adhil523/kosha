import { agentRegisterSchema, credentialSchema, receiverCreateSchema } from './registry';
import { describe, expect, it } from 'vitest';

const NONCE = 'ab'.repeat(16);
const business = {
  legalName: 'Demo GST Data Pvt Ltd',
  residency: 'resident',
  specifiedPerson: false,
  pan: 'AAPFU0939F',
  tan: 'MUMD12345E',
  gstin: '27AAPFU0939F1ZV',
  mode: 'threshold',
  challengeNonce: NONCE,
  wallets: [{ accountId: '0.0.5001', signature: 'ff00' }]
};

describe('receiverCreateSchema', () => {
  it('accepts a business receiver with PAN, TAN and GSTIN', () => {
    expect(receiverCreateSchema.safeParse(business).success).toBe(true);
  });

  it('lets a specified person register with PAN only', () => {
    const solo = { ...business, specifiedPerson: true, tan: undefined, gstin: undefined };
    expect(receiverCreateSchema.safeParse(solo).success).toBe(true);
  });

  it('requires a TAN from a resident that is not a specified person', () => {
    const result = receiverCreateSchema.safeParse({ ...business, tan: undefined });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['tan']);
  });

  it('requires a PAN from any resident, but not from a foreign API', () => {
    expect(receiverCreateSchema.safeParse({ ...business, pan: undefined }).success).toBe(false);
    const foreign = { ...business, residency: 'non_resident', pan: undefined, tan: undefined };
    expect(receiverCreateSchema.safeParse(foreign).success).toBe(true);
  });

  it('rejects a malformed PAN and a receiver with no wallets', () => {
    expect(receiverCreateSchema.safeParse({ ...business, pan: 'AAPFU0939' }).success).toBe(false);
    expect(receiverCreateSchema.safeParse({ ...business, wallets: [] }).success).toBe(false);
  });
});

describe('agent registration', () => {
  const credential = {
    issuer: 'did:key:z6MkKoshaTestIssuer',
    subject: 'hedera:testnet:0.0.6001',
    claims: { residency: 'resident', panOnFile: true, level: 1 },
    issuedAt: '2026-11-06T09:00:00Z',
    signature: 'a1b2'
  };

  it('accepts a Level 1 credential and refuses a Level 0 one', () => {
    expect(credentialSchema.safeParse(credential).success).toBe(true);
    const levelZero = { ...credential, claims: { ...credential.claims, level: 0 } };
    expect(credentialSchema.safeParse(levelZero).success).toBe(false);
  });

  it('registers an agent with or without a bootstrap reserve', () => {
    const agent = { identity: 'hedera:testnet:0.0.6001', credential, wallets: ['0.0.6001'] };
    expect(agentRegisterSchema.safeParse(agent).success).toBe(true);
    expect(agentRegisterSchema.safeParse({ ...agent, reserveAccountId: '0.0.6101' }).success).toBe(
      true
    );
  });
});
