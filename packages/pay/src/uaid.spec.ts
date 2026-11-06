import { createUaid, toBase58, uaidHash } from './uaid';
import { uaidNativeAccount } from '@kosha/hedera/hcs11-profile';
import { describe, expect, it } from 'vitest';

const RECORD = {
  registry: 'kosha',
  name: 'kosha-demo-agent-resident',
  version: '1.0.0',
  protocol: 'hcs-10',
  nativeId: 'hedera:testnet:0.0.6001',
  skills: [0]
};

describe('toBase58', () => {
  it('encodes with the bitcoin alphabet, leading zero bytes as 1s', () => {
    expect(toBase58(new Uint8Array([0, 0, 1]))).toBe('112');
    expect(toBase58(new Uint8Array([255]))).toBe('5Q');
    expect(toBase58(new TextEncoder().encode('hello'))).toBe('Cn8eVZg');
  });
});

describe('createUaid', () => {
  it('is deterministic and independent of key order', () => {
    const reordered = {
      skills: [0],
      nativeId: RECORD.nativeId,
      protocol: 'hcs-10',
      version: '1.0.0',
      name: RECORD.name,
      registry: 'kosha'
    };
    expect(uaidHash(reordered)).toBe(uaidHash(RECORD));
  });

  it('changes with the account', () => {
    expect(uaidHash({ ...RECORD, nativeId: 'hedera:testnet:0.0.6002' })).not.toBe(uaidHash(RECORD));
  });

  it('carries the routing parameters Core reads back', () => {
    const uaid = createUaid(RECORD, { uid: '0' });
    expect(uaid).toMatch(
      /^uaid:aid:[1-9A-HJ-NP-Za-km-z]+;uid=0;registry=kosha;proto=hcs-10;nativeId=hedera:testnet:0\.0\.6001$/
    );
    expect(uaidNativeAccount(uaid)).toEqual({ network: 'testnet', accountId: '0.0.6001' });
  });
});
