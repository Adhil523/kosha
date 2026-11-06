import type { PrivateKey, PublicKey } from '@hiero-ledger/sdk';
import type { AgentIdentity } from '@kosha/shared/ids';
import { type Credential, credentialSchema } from '@kosha/shared/registry';
import { canonicalJson } from '@kosha/tax-engine/rule-pack-hash';
import { createHash } from 'node:crypto';

// Core's test issuer (the MVP stand-in for a KYC provider) signs credentials with an Ed25519 key:
// ISSUER_PRIVATE_KEY. The issuer field names the public key, so a credential says who vouched for
// it; Core accepts only its own configured issuer.
const ISSUER_PREFIX = 'kosha-test-issuer:';

type UnsignedCredential = Omit<Credential, 'signature'>;

export const issuerName = (issuerKey: PublicKey): string =>
  `${ISSUER_PREFIX}${issuerKey.toStringDer()}`;

const signingBytes = (unsigned: UnsignedCredential): Uint8Array =>
  new TextEncoder().encode(canonicalJson(unsigned));

export const issueCredential = (
  issuerKey: PrivateKey,
  subject: AgentIdentity,
  claims: Credential['claims'],
  issuedAt: Date = new Date()
): Credential => {
  const unsigned = {
    issuer: issuerName(issuerKey.publicKey),
    subject,
    claims,
    issuedAt: issuedAt.toISOString()
  };
  const signature = Buffer.from(issuerKey.sign(signingBytes(unsigned))).toString('hex');
  return credentialSchema.parse({ ...unsigned, signature });
};

export type VerifiedCredential =
  | { ok: true; data: Credential['claims'] }
  | { ok: false; data: { reason: 'untrusted_issuer' | 'bad_signature' } };

export const verifyCredential = (
  credential: Credential,
  trustedIssuer: PublicKey
): VerifiedCredential => {
  if (credential.issuer !== issuerName(trustedIssuer)) {
    return { ok: false, data: { reason: 'untrusted_issuer' } };
  }
  const { signature, ...unsigned } = credential;
  const valid = trustedIssuer.verify(signingBytes(unsigned), Buffer.from(signature, 'hex'));
  return valid
    ? { ok: true, data: credential.claims }
    : { ok: false, data: { reason: 'bad_signature' } };
};

// What an agent's HCS-11 profile carries as properties.kosha.credentialHash (A18)
export const credentialHash = (credential: Credential): string =>
  `sha256:${createHash('sha256').update(canonicalJson(credential)).digest('hex')}`;
