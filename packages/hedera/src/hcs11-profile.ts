import type { FetchLike, MirrorClient } from './mirror';
import { accountIdSchema, type HederaNetwork, type Uaid } from '@kosha/shared/ids';
import { z } from 'zod';

// A Hedera HCS-14 UAID resolves through the agent account's HCS-11 profile
// (docs/research/hcs-14.md): the UAID's nativeId names the account, the account memo
// `hcs-11:hcs://1/<topic>` names the HCS-1 topic holding the profile, and the Kiloscribe CDN
// serves that inscription. This uses fetch only, like the mirror client: the standards SDK would
// bring @hashgraph/sdk and zod 3 into Core.

export const KILOSCRIBE_CDN = 'https://kiloscribe.com';

const HCS11_MEMO = /^hcs-11:hcs:\/\/1\/(0\.0\.\d+)$/;
const NATIVE_ID = /^nativeId=hedera:([a-z]+):(0\.0\.\d+)$/;

// What a Kosha agent publishes under properties.kosha (B23). The PAN is never on-chain.
const koshaPropertiesSchema = z.object({
  credentialIssuer: z.string().optional(),
  credentialHash: z.string().min(1),
  wallets: z.array(accountIdSchema).min(1)
});
export type KoshaProfileProperties = z.output<typeof koshaPropertiesSchema>;

// HCS-11 keeps custom data under `properties`; other profile fields don't matter to Kosha
const profileSchema = z.object({
  uaid: z.string().optional(),
  properties: z.object({ kosha: z.unknown().optional() }).loose().optional()
});

export type AgentProfile = {
  accountId: string;
  profileTopicId: string;
  uaid: string | null;
  // null when the profile has no properties.kosha, or it doesn't parse
  kosha: KoshaProfileProperties | null;
};

export type ProfileFailureReason =
  | 'no_native_account'
  | 'other_network'
  | 'no_profile_memo'
  | 'not_found'
  | 'http_error'
  | 'invalid_response';
export type ProfileResult =
  { ok: true; data: AgentProfile } | { ok: false; data: { reason: ProfileFailureReason } };

const fail = (reason: ProfileFailureReason): ProfileResult => ({ ok: false, data: { reason } });

// The account in a UAID's nativeId parameter, e.g. ...;nativeId=hedera:testnet:0.0.6001
export const uaidNativeAccount = (uaid: Uaid): { network: string; accountId: string } | null => {
  const [, ...params] = uaid.split(';');
  for (const param of params) {
    const match = NATIVE_ID.exec(param);
    if (match?.[1] && match[2]) return { network: match[1], accountId: match[2] };
  }
  return null;
};

export type ProfileReaderOptions = {
  mirror: Pick<MirrorClient, 'accountMemo'>;
  network: HederaNetwork;
  fetchImpl?: FetchLike;
  cdnBaseUrl?: string;
};

export const createProfileReader = ({
  mirror,
  network,
  fetchImpl = fetch,
  cdnBaseUrl = KILOSCRIBE_CDN
}: ProfileReaderOptions) => {
  const cdnRoot = cdnBaseUrl.replace(/\/+$/, '');

  const fetchInscription = async (topicId: string): Promise<{ body: unknown } | null> => {
    try {
      const response = await fetchImpl(
        `${cdnRoot}/api/inscription-cdn/${topicId}?network=${network}`
      );
      return response.ok ? { body: await response.json() } : null;
    } catch {
      return null;
    }
  };

  const profileForUaid = async (uaid: Uaid): Promise<ProfileResult> => {
    const native = uaidNativeAccount(uaid);
    if (!native) return fail('no_native_account');
    if (native.network !== network) return fail('other_network');

    const memo = await mirror.accountMemo(native.accountId);
    if (!memo.ok) return fail(memo.data.reason);
    const profileTopicId = HCS11_MEMO.exec(memo.data)?.[1];
    if (!profileTopicId) return fail('no_profile_memo');

    const inscription = await fetchInscription(profileTopicId);
    if (!inscription) return fail('http_error');
    const profile = profileSchema.safeParse(inscription.body);
    if (!profile.success) return fail('invalid_response');

    const kosha = koshaPropertiesSchema.safeParse(profile.data.properties?.kosha);
    return {
      ok: true,
      data: {
        accountId: native.accountId,
        profileTopicId,
        uaid: profile.data.uaid ?? null,
        kosha: kosha.success ? kosha.data : null
      }
    };
  };

  return { profileForUaid };
};

export type ProfileReader = ReturnType<typeof createProfileReader>;
