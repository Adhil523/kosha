// The demo's stand-in for the agent operator's wallet (B25): the seeded agents' own keys, from
// the shared env file, used only to co-sign their reserve releases. HashPack would replace it.

export const DEMO_SIGNER_LABEL = 'demo signer';

const SEEDED_AGENTS = ['AGENT_RESIDENT', 'AGENT_NONRESIDENT', 'AGENT_UNKNOWN'] as const;

export type DemoSigner = { accountId: string; privateKey: string };

// The seeded agent that declared one of these wallets, with its key; null for any other agent
export const pickDemoSigner = (
  env: Record<string, string | undefined>,
  wallets: readonly string[]
): DemoSigner | null => {
  for (const name of SEEDED_AGENTS) {
    const accountId = env[`${name}_ACCOUNT_ID`]?.trim();
    const privateKey = env[`${name}_PRIVATE_KEY`]?.trim();
    if (accountId && privateKey && wallets.includes(accountId)) return { accountId, privateKey };
  }
  return null;
};
