import type { RegisterRoutes } from './app';
import { generateApiKey, hashApiKey, requireAdmin } from './auth';
import type { ChallengeStore } from './challenges';
import type { KoshaDb } from './db/client';
import { receiver, receiverWallet } from './db/schema';
import type { PublicKey } from '@hiero-ledger/sdk';
import { type ErrorResponse, errorResponseSchema } from '@kosha/shared/error-codes';
import {
  receiverChallengeSchema,
  receiverCreatedSchema,
  receiverCreateSchema
} from '@kosha/shared/registry';
import type { UnverifiedPolicy } from '@kosha/tax-engine/rule-pack';
import { inArray } from 'drizzle-orm';
import { createHmac } from 'node:crypto';

// An account's current public key, from the Mirror Node in Core (wired once A08 lands)
export type KeyLookup = (accountId: string) => Promise<PublicKey | null>;

export type ReceiverRouteDeps = {
  db: KoshaDb;
  adminToken: string;
  panCommitSecret: string;
  keyLookup: KeyLookup;
  challenges: ChallengeStore;
  // The rule pack's unverifiedPayer.defaultPolicy
  defaultUnverifiedPolicy: UnverifiedPolicy;
};

// Salted so a leaked database can't be matched against known PANs
export const panCommitment = (pan: string, secret: string): string =>
  createHmac('sha256', secret).update(pan).digest('hex');

const invalid = (message: string): ErrorResponse => ({ error: 'invalid_payload', message });

export const receiverRoutes =
  (deps: ReceiverRouteDeps): RegisterRoutes =>
  (app) => {
    const admin = { preHandler: requireAdmin(deps.adminToken) };

    app.get(
      '/v1/receivers/challenge',
      { ...admin, schema: { response: { 200: receiverChallengeSchema } } },
      () => deps.challenges.issue()
    );

    app.post(
      '/v1/receivers',
      {
        ...admin,
        schema: {
          body: receiverCreateSchema,
          response: { 201: receiverCreatedSchema, 400: errorResponseSchema }
        }
      },
      async (request, reply) => {
        const body = request.body;
        if (!deps.challenges.consume(body.challengeNonce)) {
          return reply.status(400).send(invalid('challenge expired or already used'));
        }

        const nonce = new TextEncoder().encode(body.challengeNonce);
        for (const wallet of body.wallets) {
          const key = await deps.keyLookup(wallet.accountId);
          if (!key || !key.verify(nonce, Buffer.from(wallet.signature, 'hex'))) {
            return reply
              .status(400)
              .send(invalid(`wallet ${wallet.accountId} did not prove ownership`));
          }
        }

        const accountIds = body.wallets.map((wallet) => wallet.accountId);
        const taken = await deps.db
          .select({ accountID: receiverWallet.accountID })
          .from(receiverWallet)
          .where(inArray(receiverWallet.accountID, accountIds));
        if (taken.length > 0) {
          return reply.status(400).send(invalid('a wallet is already registered'));
        }

        const apiKey = body.apiKey ?? generateApiKey();
        const verifiedAt = new Date();
        const receiverId = await deps.db.transaction(async (tx) => {
          const [created] = await tx
            .insert(receiver)
            .values({
              legalName: body.legalName,
              panCommitment: body.pan ? panCommitment(body.pan, deps.panCommitSecret) : null,
              tan: body.tan ?? null,
              gstin: body.gstin ?? null,
              residency: body.residency,
              specifiedPerson: body.specifiedPerson,
              mode: body.mode,
              unverifiedPolicy: body.unverifiedPolicy ?? deps.defaultUnverifiedPolicy,
              apiKeyHash: hashApiKey(apiKey)
            })
            .returning({ id: receiver.id });
          const id = created?.id ?? '';
          await tx.insert(receiverWallet).values(
            body.wallets.map((wallet) => ({
              receiverID: id,
              accountID: wallet.accountId,
              proofSignature: wallet.signature,
              verifiedAt
            }))
          );
          return id;
        });

        // A generated key is returned once and never stored; a supplied one is not echoed
        return reply.status(201).send({ receiverId, apiKey: body.apiKey ? undefined : apiKey });
      }
    );
  };
