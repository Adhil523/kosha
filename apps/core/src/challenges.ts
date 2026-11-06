import { randomBytes } from 'node:crypto';

// Single-use nonces that a receiver's wallets sign to prove ownership. In memory: Core runs as one
// process, and a challenge only has to outlive the onboarding request that follows it.
const NONCE_BYTES = 32;
export const CHALLENGE_TTL_MS = 10 * 60 * 1000;

export type Challenge = { nonce: string; expiresAt: string };

export const createChallengeStore = (now: () => Date = () => new Date()) => {
  const open = new Map<string, number>();

  const issue = (): Challenge => {
    const nonce = randomBytes(NONCE_BYTES).toString('hex');
    const expiresAt = now().getTime() + CHALLENGE_TTL_MS;
    open.set(nonce, expiresAt);
    return { nonce, expiresAt: new Date(expiresAt).toISOString() };
  };

  // True once per issued, unexpired nonce
  const consume = (nonce: string): boolean => {
    const expiresAt = open.get(nonce);
    open.delete(nonce);
    return expiresAt !== undefined && now().getTime() <= expiresAt;
  };

  return { issue, consume };
};

export type ChallengeStore = ReturnType<typeof createChallengeStore>;
