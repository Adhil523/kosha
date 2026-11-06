import { credentialHash } from '@kosha/hedera/credentials';
import type { ProfileFailureReason, ProfileReader } from '@kosha/hedera/hcs11-profile';
import { type AgentIdentity, uaidSchema } from '@kosha/shared/ids';
import type { Credential } from '@kosha/shared/registry';

// A18: an agent registering with a UAID must back it with its HCS-11 profile
// (docs/research/hcs-14.md). The account memo is set with the agent's own key, so a profile that
// names this UAID, this credential's hash and these wallets proves the agent controls the account.

export type ProfileCache = { profileTopicID: string; profileCheckedAt: Date };
export type ProfileCheckFailure = { reason: 'mismatch' | 'unavailable'; message: string };
export type ProfileCheckResult =
  // data is null for a CAIP-10 identity: there is no profile to check
  { ok: true; data: ProfileCache | null } | { ok: false; data: ProfileCheckFailure };

const readerFailure = (reason: ProfileFailureReason): ProfileCheckFailure => {
  switch (reason) {
    case 'no_native_account':
      return { reason: 'mismatch', message: 'the UAID has no Hedera nativeId' };
    case 'other_network':
      return { reason: 'mismatch', message: 'the UAID names an account on another network' };
    case 'not_found':
      return { reason: 'mismatch', message: 'the UAID names an unknown account' };
    case 'no_profile_memo':
      return {
        reason: 'mismatch',
        message: "the agent account's memo does not point to an HCS-11 profile"
      };
    case 'invalid_response':
      return { reason: 'mismatch', message: 'the HCS-11 profile is not valid' };
    case 'http_error':
      return { reason: 'unavailable', message: 'the HCS-11 profile could not be fetched; retry' };
  }
};

const mismatch = (message: string): ProfileCheckResult => ({
  ok: false,
  data: { reason: 'mismatch', message }
});

const sameWallets = (declared: readonly string[], published: readonly string[]): boolean => {
  const want = new Set(declared);
  const have = new Set(published);
  return want.size === have.size && [...want].every((wallet) => have.has(wallet));
};

export const checkAgentProfile = async (
  reader: Pick<ProfileReader, 'profileForUaid'>,
  request: { identity: AgentIdentity; credential?: Credential; wallets: readonly string[] }
): Promise<ProfileCheckResult> => {
  const uaid = uaidSchema.safeParse(request.identity);
  if (!uaid.success) return { ok: true, data: null };

  const profile = await reader.profileForUaid(uaid.data);
  if (!profile.ok) return { ok: false, data: readerFailure(profile.data.reason) };

  const { uaid: publishedUaid, kosha, profileTopicId } = profile.data;
  if (publishedUaid !== request.identity) return mismatch('the HCS-11 profile names another UAID');
  if (!kosha) return mismatch('the HCS-11 profile has no properties.kosha');
  if (request.credential && kosha.credentialHash !== credentialHash(request.credential)) {
    return mismatch('the credential does not match the hash in the HCS-11 profile');
  }
  if (!sameWallets(request.wallets, kosha.wallets)) {
    return mismatch('the declared wallets differ from the HCS-11 profile');
  }
  return { ok: true, data: { profileTopicID: profileTopicId, profileCheckedAt: new Date() } };
};
