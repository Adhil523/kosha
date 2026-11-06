import type { ActiveRulePack } from './active-rule-pack';
import { agentRoutes } from './agent-routes';
import type { RegisterRoutes } from './app';
import { createChallengeStore } from './challenges';
import { type CoreConfig, SETTLEMENT_NODE_ACCOUNT_IDS } from './config';
import type { KoshaDb } from './db/client';
import { createEventBus } from './event-bus';
import { facilitatorRoutes } from './facilitator-routes';
import { demoFixedFx } from './fx';
import type { OutboxDeps } from './hcs-outbox';
import { ledgerRoutes } from './ledger-routes';
import { policyRoutes } from './policy-routes';
import { quoteRoutes } from './quote-routes';
import { receiverRoutes } from './receiver-routes';
import { mirrorReconciler } from './reconcile';
import { createPayerResolver } from './resolve-payer';
import { announceSettlement } from './settlement-events';
import { streamRoutes } from './stream-routes';
import { supportedRoutes } from './supported-routes';
import type { Client, PrivateKey, TransferTransaction } from '@hiero-ledger/sdk';
import { parsePrivateKey } from '@kosha/hedera/client';
import { clientExecutor } from '@kosha/hedera/executor';
import { submitMessage } from '@kosha/hedera/hcs';
import { createProfileReader } from '@kosha/hedera/hcs11-profile';
import { createMirrorClient } from '@kosha/hedera/mirror';
import { mirrorPayerKey } from '@kosha/hedera/payer-key';
import { createReserveAccount } from '@kosha/hedera/reserve';

// How long Core asks the Mirror Node about a settlement whose receipt timed out
const RECONCILE = { attempts: 5, delayMs: 2_000 };

export type CoreWiring = { routes: RegisterRoutes[]; outbox: OutboxDeps };
export type WiringResult =
  { ok: true; data: CoreWiring } | { ok: false; data: { problem: string } };

// Builds every route's dependencies from the validated config: one operator client (Core, the fee
// payer), one Mirror client, one database. Tests build routes with fakes instead.
export const wireCore = (
  config: CoreConfig,
  rulePack: ActiveRulePack,
  db: KoshaDb,
  operator: { client: Client; key: PrivateKey }
): WiringResult => {
  const issuer = parsePrivateKey(config.issuerPrivateKey);
  if (!issuer.ok) return { ok: false, data: { problem: 'ISSUER_PRIVATE_KEY is not a usable key' } };
  const fx = demoFixedFx(config.fxInrPerUsd);
  if (!fx) return { ok: false, data: { problem: 'FX_DEMO_INR_PER_USD is not a usable rate' } };

  const execute = clientExecutor(operator.client);
  const mirror = createMirrorClient(config.mirrorUrl);
  const payerKey = mirrorPayerKey(mirror);

  // A Level 0 agent's reserve is created at its first quote: a 2-of-2 of its key and Core's
  const createReserve = async (payerAccountId: string): Promise<string | null> => {
    const agentKey = await payerKey(payerAccountId);
    if (!agentKey.ok) return null;
    const created = await createReserveAccount(execute, {
      agentKey: agentKey.data,
      coreKey: operator.key.publicKey
    });
    return created.ok ? created.data.accountId : null;
  };

  // Core signs as fee payer on top of the payer's signature, then submits
  const executeSettlement = async (transaction: TransferTransaction) => {
    await transaction.sign(operator.key);
    return execute(transaction);
  };

  // Settlements publish here; each open /v1/stream subscribes to its receiver
  const bus = createEventBus();

  const settlement = {
    db,
    feePayer: config.coreAccountId,
    settlementTokenId: config.settlementTokenId,
    maxTransactionFeeHbar: config.maxTxFeeHbar
  };

  const routes: RegisterRoutes[] = [
    supportedRoutes({ network: config.network, feePayer: config.coreAccountId, rulePack }),
    receiverRoutes({
      db,
      adminToken: config.adminToken,
      panCommitSecret: config.panCommitSecret,
      keyLookup: async (accountId) => {
        const key = await payerKey(accountId);
        return key.ok ? key.data : null;
      },
      challenges: createChallengeStore(),
      defaultUnverifiedPolicy: rulePack.pack.unverifiedPayer.defaultPolicy
    }),
    agentRoutes({
      db,
      adminToken: config.adminToken,
      issuerKey: issuer.data.publicKey,
      profileReader: createProfileReader({ mirror, network: config.network })
    }),
    policyRoutes({ db, adminToken: config.adminToken }),
    quoteRoutes({
      ...settlement,
      rulePack,
      fx,
      resolvePayer: createPayerResolver(db, createReserve),
      network: config.network,
      nodeAccountIds: SETTLEMENT_NODE_ACCOUNT_IDS
    }),
    ledgerRoutes({
      db,
      adminToken: config.adminToken,
      network: config.network,
      pack: rulePack.pack
    }),
    streamRoutes({ db, adminToken: config.adminToken, bus }),
    facilitatorRoutes({
      ...settlement,
      payerKey,
      network: config.network,
      ledger: {
        pairSecret: config.pairHmacSecret,
        rulepackHash: rulePack.hash,
        paymentsTopicId: config.paymentsTopicId
      },
      execute: executeSettlement,
      announce: (settled) =>
        announceSettlement({ db, bus, pack: rulePack.pack, network: config.network }, settled),
      reconcile: mirrorReconciler(mirror, RECONCILE)
    })
  ];

  return {
    ok: true,
    data: {
      routes,
      outbox: { db, submit: (topicId, message) => submitMessage(execute, topicId, message) }
    }
  };
};
