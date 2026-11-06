import { buildClient, coreClientFromEnv, parsePrivateKey } from './client';
import { PrivateKey } from '@hiero-ledger/sdk';
import { describe, expect, it } from 'vitest';

describe('parsePrivateKey', () => {
  it('parses DER keys of both curves', () => {
    const ed = PrivateKey.generateED25519();
    const ec = PrivateKey.generateECDSA();

    const parsedEd = parsePrivateKey(ed.toStringDer());
    const parsedEc = parsePrivateKey(ec.toStringDer());

    expect(parsedEd.ok && parsedEd.data.publicKey.equals(ed.publicKey)).toBe(true);
    expect(parsedEc.ok && parsedEc.data.publicKey.equals(ec.publicKey)).toBe(true);
  });

  it('parses a raw ECDSA key with the 0x prefix', () => {
    const ec = PrivateKey.generateECDSA();
    const parsed = parsePrivateKey(`0x${ec.toStringRaw()}`);
    expect(parsed.ok && parsed.data.publicKey.equals(ec.publicKey)).toBe(true);
  });

  it('refuses a raw key with no type, and parses it once the type is given', () => {
    const ed = PrivateKey.generateED25519();
    expect(parsePrivateKey(ed.toStringRaw())).toEqual({
      ok: false,
      data: { reason: 'ambiguous_raw_key' }
    });
    const parsed = parsePrivateKey(ed.toStringRaw(), 'ed25519');
    expect(parsed.ok && parsed.data.publicKey.equals(ed.publicKey)).toBe(true);
  });

  it('refuses text that is not a key', () => {
    expect(parsePrivateKey('not-a-key')).toEqual({
      ok: false,
      data: { reason: 'unrecognised_key' }
    });
    expect(parsePrivateKey('302e' + 'zz'.repeat(10))).toEqual({
      ok: false,
      data: { reason: 'unrecognised_key' }
    });
  });
});

describe('buildClient', () => {
  const privateKey = PrivateKey.generateED25519().toStringDer();

  it('builds a testnet client with the operator set', () => {
    const built = buildClient({ network: 'testnet', operatorId: '0.0.4000', privateKey });

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.data.client.operatorAccountId?.toString()).toBe('0.0.4000');
    expect(built.data.client.ledgerId?.toString()).toBe('testnet');
    built.data.client.close();
  });

  it('names the invalid fields without echoing the key', () => {
    const built = buildClient({ network: 'previewnet', operatorId: 'core', privateKey });
    expect(built).toEqual({
      ok: false,
      data: { reason: 'invalid_config', fields: ['network', 'operatorId'] }
    });
  });

  it('reads Core from the env and reports an empty env as invalid', () => {
    const env = {
      HEDERA_NETWORK: 'testnet',
      CORE_ACCOUNT_ID: '0.0.4000',
      CORE_PRIVATE_KEY: privateKey
    };
    const built = coreClientFromEnv(env);
    expect(built.ok).toBe(true);
    if (built.ok) built.data.client.close();

    expect(coreClientFromEnv({})).toEqual({
      ok: false,
      data: { reason: 'invalid_config', fields: ['network', 'operatorId', 'privateKey'] }
    });
  });
});
