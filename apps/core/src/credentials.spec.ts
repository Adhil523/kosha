import { credentialHash, issueCredential, verifyCredential } from './credentials';
import { PrivateKey } from '@hiero-ledger/sdk';
import { agentIdentitySchema } from '@kosha/shared/ids';
import { describe, expect, it } from 'vitest';

const ISSUER = PrivateKey.generateED25519();
const SUBJECT = agentIdentitySchema.parse('hedera:testnet:0.0.6001');
const CLAIMS = { residency: 'resident', panOnFile: true, level: 1 } as const;

describe('test credential issuer', () => {
  it('issues a credential that verifies against the issuer', () => {
    const credential = issueCredential(ISSUER, SUBJECT, CLAIMS, new Date('2026-11-06T09:00:00Z'));

    expect(credential.issuedAt).toBe('2026-11-06T09:00:00.000Z');
    expect(verifyCredential(credential, ISSUER.publicKey)).toEqual({ ok: true, data: CLAIMS });
  });

  it('refuses a credential from another issuer', () => {
    const credential = issueCredential(PrivateKey.generateED25519(), SUBJECT, CLAIMS);
    expect(verifyCredential(credential, ISSUER.publicKey)).toEqual({
      ok: false,
      data: { reason: 'untrusted_issuer' }
    });
  });

  it('refuses a credential whose claims were changed after signing', () => {
    const credential = issueCredential(ISSUER, SUBJECT, { ...CLAIMS, panOnFile: false });
    const upgraded = { ...credential, claims: { ...credential.claims, panOnFile: true } };
    expect(verifyCredential(upgraded, ISSUER.publicKey)).toEqual({
      ok: false,
      data: { reason: 'bad_signature' }
    });
  });

  it('hashes a credential the same way regardless of key order', () => {
    const credential = issueCredential(ISSUER, SUBJECT, CLAIMS);
    const reordered = {
      signature: credential.signature,
      issuedAt: credential.issuedAt,
      claims: { level: CLAIMS.level, panOnFile: CLAIMS.panOnFile, residency: CLAIMS.residency },
      subject: credential.subject,
      issuer: credential.issuer
    };
    expect(credentialHash(reordered)).toBe(credentialHash(credential));
    expect(credentialHash(credential)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
