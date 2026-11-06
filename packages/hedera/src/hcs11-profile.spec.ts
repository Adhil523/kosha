import { createProfileReader, uaidNativeAccount } from './hcs11-profile';
import type { FetchLike, MirrorResult } from './mirror';
import { type Uaid, uaidSchema } from '@kosha/shared/ids';
import { describe, expect, it } from 'vitest';

const UAID = uaidSchema.parse(
  'uaid:aid:7Hq3JX9;uid=0;registry=kosha;proto=hcs-10;nativeId=hedera:testnet:0.0.6001'
);
const CDN_URL = 'https://kiloscribe.com/api/inscription-cdn/0.0.7001?network=testnet';
const KOSHA = {
  credentialIssuer: 'kosha-test-issuer:ab',
  credentialHash: 'sha256:00',
  wallets: ['0.0.6001']
};

const mirrorWith = (memo: MirrorResult<string>) => ({ accountMemo: async () => memo });
const cdnWith = (status: number, body: unknown) => {
  const requested: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    requested.push(url);
    return { ok: status < 400, status, json: async () => body };
  };
  return { fetchImpl, requested };
};
const reader = (memo: MirrorResult<string>, status = 200, body: unknown = {}) => {
  const cdn = cdnWith(status, body);
  const profiles = createProfileReader({
    mirror: mirrorWith(memo),
    network: 'testnet',
    fetchImpl: cdn.fetchImpl
  });
  return { profiles, requested: cdn.requested };
};
const PROFILE_MEMO: MirrorResult<string> = { ok: true, data: 'hcs-11:hcs://1/0.0.7001' };

describe('uaidNativeAccount', () => {
  it('reads the account from the nativeId parameter', () => {
    expect(uaidNativeAccount(UAID)).toEqual({ network: 'testnet', accountId: '0.0.6001' });
  });

  it('returns null without a Hedera nativeId', () => {
    expect(uaidNativeAccount(uaidSchema.parse('uaid:aid:7Hq3JX9;uid=0'))).toBeNull();
    expect(uaidNativeAccount(uaidSchema.parse('uaid:aid:x;nativeId=eip155:1:0xab'))).toBeNull();
  });
});

describe('profile reader', () => {
  it('follows the account memo to the inscribed profile', async () => {
    const { profiles, requested } = reader(PROFILE_MEMO, 200, {
      version: '1.0',
      type: 1,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- HCS-11's own field name
      display_name: 'Kosha Demo Agent 1',
      uaid: UAID,
      properties: { kosha: KOSHA, other: true }
    });
    expect(await profiles.profileForUaid(UAID)).toEqual({
      ok: true,
      data: { accountId: '0.0.6001', profileTopicId: '0.0.7001', uaid: UAID, kosha: KOSHA }
    });
    expect(requested).toEqual([CDN_URL]);
  });

  it('returns kosha as null when the profile has no valid properties.kosha', async () => {
    const { profiles } = reader(PROFILE_MEMO, 200, {
      uaid: UAID,
      properties: { kosha: { wallets: [] } }
    });
    const result = await profiles.profileForUaid(UAID);
    expect(result.ok && result.data.kosha).toBeNull();
  });

  it.each<[string, Uaid, MirrorResult<string>, number, unknown, string]>([
    [
      'no nativeId',
      uaidSchema.parse('uaid:aid:x;uid=0'),
      PROFILE_MEMO,
      200,
      {},
      'no_native_account'
    ],
    [
      'another network',
      uaidSchema.parse('uaid:aid:x;nativeId=hedera:mainnet:0.0.6001'),
      PROFILE_MEMO,
      200,
      {},
      'other_network'
    ],
    [
      'an unknown account',
      UAID,
      { ok: false, data: { reason: 'not_found' } },
      200,
      {},
      'not_found'
    ],
    [
      'a memo that is not HCS-11',
      UAID,
      { ok: true, data: 'kosha agent' },
      200,
      {},
      'no_profile_memo'
    ],
    ['an IPFS profile', UAID, { ok: true, data: 'hcs-11:ipfs://bafy' }, 200, {}, 'no_profile_memo'],
    ['the CDN failing', UAID, PROFILE_MEMO, 503, {}, 'http_error'],
    ['a profile that is not an object', UAID, PROFILE_MEMO, 200, 'nope', 'invalid_response']
  ])('fails on %s', async (_case, uaid, memo, status, body, reason) => {
    const { profiles } = reader(memo, status, body);
    expect(await profiles.profileForUaid(uaid)).toEqual({ ok: false, data: { reason } });
  });
});
