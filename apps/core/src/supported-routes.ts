import type { ActiveRulePack } from './active-rule-pack';
import type { RegisterRoutes } from './app';
import { supportedResponseSchema } from '@kosha/shared/facilitator-api';
import { SCHEMES, X402_NETWORKS, X402_VERSION } from '@kosha/shared/headers';
import type { AccountId, HederaNetwork } from '@kosha/shared/ids';

export type SupportedDeps = {
  network: HederaNetwork;
  // Core's account: the fee payer named in every quote
  feePayer: AccountId;
  rulePack: ActiveRulePack;
};

// GET /v1/supported: what Core settles (x402 v2 kinds) and which rule pack decides the tax
export const supportedRoutes =
  ({ network, feePayer, rulePack }: SupportedDeps): RegisterRoutes =>
  (app) => {
    const x402Network = X402_NETWORKS[network];
    const body = supportedResponseSchema.parse({
      kinds: [SCHEMES.koshaSplit, SCHEMES.exact].map((scheme) => ({
        x402Version: X402_VERSION,
        scheme,
        network: x402Network,
        extra: { feePayer }
      })),
      extensions: [],
      signers: { 'hedera:*': [feePayer] },
      kosha: {
        rulepack: {
          id: rulePack.pack.id,
          hash: rulePack.hash,
          reviewedBy: rulePack.pack.reviewedBy
        }
      }
    });

    app.get(
      '/v1/supported',
      { schema: { response: { 200: supportedResponseSchema } } },
      () => body
    );
  };
