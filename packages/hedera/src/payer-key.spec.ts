import type { MirrorAccountKey, MirrorResult } from './mirror';
import { mirrorPayerKey, publicKeyFromMirror } from './payer-key';
import { PrivateKey } from '@hiero-ledger/sdk';
import { describe, expect, it } from 'vitest';

const ED = PrivateKey.generateED25519().publicKey;
const EC = PrivateKey.generateECDSA().publicKey;
const lookupWith = (result: MirrorResult<MirrorAccountKey>) =>
  mirrorPayerKey({ accountKey: async () => result });

describe('payer keys from the Mirror Node', () => {
  it('reads ED25519 and ECDSA keys', () => {
    expect(publicKeyFromMirror({ type: 'ED25519', hex: ED.toStringRaw() })?.toStringRaw()).toBe(
      ED.toStringRaw()
    );
    expect(
      publicKeyFromMirror({ type: 'ECDSA_SECP256K1', hex: EC.toStringRaw() })?.toStringRaw()
    ).toBe(EC.toStringRaw());
  });

  it('refuses key lists and malformed keys', () => {
    expect(publicKeyFromMirror({ type: 'ProtobufEncoded', hex: 'ab' })).toBeNull();
    expect(publicKeyFromMirror({ type: 'ED25519', hex: 'zz' })).toBeNull();
  });

  it('tells an outage apart from an account that cannot sign', async () => {
    const found = await lookupWith({ ok: true, data: { type: 'ED25519', hex: ED.toStringRaw() } })(
      '0.0.6001'
    );
    expect(found.ok && found.data.toStringRaw()).toBe(ED.toStringRaw());
    expect(await lookupWith({ ok: false, data: { reason: 'http_error' } })('0.0.6001')).toEqual({
      ok: false,
      data: { reason: 'unavailable' }
    });
    expect(await lookupWith({ ok: false, data: { reason: 'not_found' } })('0.0.6001')).toEqual({
      ok: false,
      data: { reason: 'unsupported_key' }
    });
  });
});
