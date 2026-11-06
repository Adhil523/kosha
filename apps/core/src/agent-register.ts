import { findAgentByIdentity } from './agent-identity';
import { checkAgentProfile, type ProfileCheckResult } from './agent-profile';
import { loadAgentRow } from './agent-rows';
import type { KoshaDb } from './db/client';
import { agent, agentWallet } from './db/schema';
import type { PublicKey } from '@hiero-ledger/sdk';
import { credentialHash, verifyCredential } from '@kosha/hedera/credentials';
import type { ProfileReader } from '@kosha/hedera/hcs11-profile';
import type { ErrorResponse } from '@kosha/shared/error-codes';
import { uaidSchema } from '@kosha/shared/ids';
import type { AgentRegister, AgentRow } from '@kosha/shared/registry';
import { eq, inArray } from 'drizzle-orm';

export type RegisterDeps = {
  db: KoshaDb;
  // Core's test issuer (ISSUER_PRIVATE_KEY's public key)
  issuerKey: PublicKey;
  // Checks a UAID against its HCS-11 profile (A18). Without one, Core registers the UAID and
  // credential only: the spec's fallback for when the Kiloscribe CDN is down.
  profileReader?: Pick<ProfileReader, 'profileForUaid'>;
};

export type RegisterResult =
  | { ok: true; data: { row: AgentRow; created: boolean } }
  | { ok: false; data: { status: 400 | 502; body: ErrorResponse } };

const NO_PROFILE_CHECK: ProfileCheckResult = { ok: true, data: null };

const refuse = (message: string): RegisterResult => ({
  ok: false,
  data: { status: 400, body: { error: 'invalid_payload', message } }
});

// Registers an agent or updates it: Level 0 → Level 1 once it presents a credential, or CAIP-10 →
// UAID for the same account. The caller has already established who may register this identity.
export const registerAgent = async (
  deps: RegisterDeps,
  { identity, credential, wallets, reserveAccountId }: AgentRegister
): Promise<RegisterResult> => {
  let verified: {
    residency: 'resident' | 'non_resident';
    panOnFile: boolean;
    level: 1 | 2;
  } | null = null;
  if (credential) {
    if (credential.subject !== identity) return refuse('the credential names another agent');
    const checked = verifyCredential(credential, deps.issuerKey);
    if (!checked.ok) return refuse(`credential ${checked.data.reason}`);
    verified = checked.data;
  }

  const profileCheck = deps.profileReader
    ? await checkAgentProfile(deps.profileReader, { identity, credential, wallets })
    : NO_PROFILE_CHECK;
  if (!profileCheck.ok) {
    const { reason, message } = profileCheck.data;
    return reason === 'unavailable'
      ? { ok: false, data: { status: 502, body: { error: 'internal_error', message } } }
      : refuse(message);
  }

  // Found by identity, or by its account when an agent moves from CAIP-10 to a UAID
  const existing = await findAgentByIdentity(deps.db, identity);
  const owners = await deps.db
    .select({ accountID: agentWallet.accountID, agentID: agentWallet.agentID })
    .from(agentWallet)
    .where(inArray(agentWallet.accountID, wallets));
  if (owners.some((owner) => owner.agentID !== existing?.id)) {
    return refuse('a wallet belongs to another agent');
  }

  const profile = verified
    ? {
        level: verified.level,
        residency: verified.residency,
        panOnFile: verified.panOnFile,
        credentialIssuer: credential?.issuer ?? null,
        credentialHash: credential ? credentialHash(credential) : null,
        verifiedAt: new Date()
      }
    : {};
  const profileCache = profileCheck.data ?? {};

  const agentId = await deps.db.transaction(async (tx) => {
    const [saved] = existing
      ? await tx
          .update(agent)
          .set({
            // A UAID replaces the CAIP-10 identity it grew from; never the other way
            identity: uaidSchema.safeParse(identity).success ? identity : existing.identity,
            ...profile,
            ...profileCache,
            reserveAccountID: existing.reserveAccountID ?? reserveAccountId ?? null
          })
          .where(eq(agent.id, existing.id))
          .returning({ id: agent.id })
      : await tx
          .insert(agent)
          .values({
            identity,
            reserveAccountID: reserveAccountId ?? null,
            ...profile,
            ...profileCache
          })
          .returning({ id: agent.id });
    const id = saved?.id ?? '';
    const known = new Set(owners.map((owner) => owner.accountID));
    const fresh = wallets.filter((wallet) => !known.has(wallet));
    if (fresh.length > 0) {
      await tx.insert(agentWallet).values(fresh.map((accountID) => ({ agentID: id, accountID })));
    }
    return id;
  });

  const row = await loadAgentRow(deps.db, agentId);
  // Just written in this request; the error handler answers internal_error if it's gone
  if (!row) throw new Error('[agents]: saved agent could not be read back');
  return { ok: true, data: { row, created: !existing } };
};
