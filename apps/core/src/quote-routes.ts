import type { ActiveRulePack } from './active-rule-pack';
import type { RegisterRoutes } from './app';
import { authenticateReceiver } from './auth';
import type { KoshaDb } from './db/client';
import { quote, receiverWallet } from './db/schema';
import type { FxSource } from './fx';
import { pairTotalPaise, withPairLock } from './pair-total';
import type { ResolvePayer } from './resolve-payer';
import { type ErrorResponse, errorResponseSchema } from '@kosha/shared/error-codes';
import { quoteRequestSchema } from '@kosha/shared/facilitator-api';
import { SCHEMES, X402_NETWORKS, X402_VERSION } from '@kosha/shared/headers';
import type { HederaNetwork } from '@kosha/shared/ids';
import { amountToBigint } from '@kosha/shared/money';
import { checkSplitQuote } from '@kosha/shared/split-quote';
import { type PaymentRequired, paymentRequiredSchema, quoteMemo } from '@kosha/shared/x402-payment';
import { applyFunding } from '@kosha/tax-engine/apply-funding';
import { decide } from '@kosha/tax-engine/decide';
import { financialYear } from '@kosha/tax-engine/ist-calendar';
import { asc, eq } from 'drizzle-orm';

// Hedera transactions are valid for 180 s; a quote expires well inside that
export const QUOTE_TTL_SECONDS = 120;

export type QuoteRouteDeps = {
  db: KoshaDb;
  rulePack: ActiveRulePack;
  fx: FxSource;
  resolvePayer: ResolvePayer;
  network: HederaNetwork;
  // Core: fee payer of every settlement
  feePayer: string;
  settlementTokenId: string;
  // Three nodes, so one busy node can't block settlement
  nodeAccountIds: string[];
  // Shown to Level 0 payers: how to verify and drop from 20% to 1%
  registerUrl?: string;
  now?: () => Date;
};

const invalid = (message: string): ErrorResponse => ({ error: 'invalid_payload', message });

export const quoteRoutes =
  (deps: QuoteRouteDeps): RegisterRoutes =>
  (app) => {
    const now = deps.now ?? (() => new Date());
    const { pack } = deps.rulePack;

    app.post(
      '/v1/quote',
      {
        schema: {
          body: quoteRequestSchema,
          response: {
            200: paymentRequiredSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            503: errorResponseSchema
          }
        }
      },
      async (request, reply) => {
        const auth = await authenticateReceiver(deps.db, request);
        if (!auth.ok) return reply.status(401).send(auth.data);
        const receiver = auth.data;

        const { agent: identity, priceMicroUsdc, resource } = request.body;
        if (!identity) {
          return reply
            .status(400)
            .send(invalid('X-KOSHA-AGENT is required until compatibility mode is available'));
        }
        const payer = await deps.resolvePayer(identity);
        if (!payer.ok)
          return reply.status(payer.data.error === 'core_unavailable' ? 503 : 400).send(payer.data);

        const [payTo] = await deps.db
          .select({ accountID: receiverWallet.accountID })
          .from(receiverWallet)
          .where(eq(receiverWallet.receiverID, receiver.id))
          .orderBy(asc(receiverWallet.createdAt));
        if (!payTo) return reply.status(400).send({ error: 'unknown_receiver' });

        const issuedAt = now();
        const rate = await deps.fx.current();
        const price = amountToBigint(priceMicroUsdc);
        const pair = {
          agentId: payer.data.agentId,
          receiverId: receiver.id,
          fy: financialYear(issuedAt, pack.financialYearStart)
        };

        const saved = await withPairLock(deps.db, pair, async (tx) => {
          const decision = decide({
            payer: { residency: payer.data.residency, panOnFile: payer.data.panOnFile },
            receiver: {
              residency: receiver.residency,
              specifiedPerson: receiver.specifiedPerson,
              mode: receiver.mode,
              unverifiedPolicy: receiver.unverifiedPolicy
            },
            priceMicroUsdc: price,
            inrPerUsdMicro: rate.inrPerUsdMicro,
            aggregatePaise: await pairTotalPaise(tx, pair, issuedAt),
            pack
          });
          const split = applyFunding({
            priceMicroUsdc: price,
            tdsMicroUsdc: decision.tdsMicroUsdc
          });
          const [row] = await tx
            .insert(quote)
            .values({
              scheme: 'kosha_split',
              receiverID: receiver.id,
              agentID: payer.data.agentId,
              resource: resource.url,
              payToAccountID: payTo.accountID,
              reserveAccountID: payer.data.reserveAccountId,
              priceMicro: split.receiverMicro,
              tdsMicro: split.reserveMicro,
              totalMicro: split.payerTotalMicro,
              inrValuePaise: decision.valuePaise,
              rateBps: decision.rateBps,
              reason: decision.reason,
              rulepack: decision.rulepack,
              inrPerUsdMicro: rate.inrPerUsdMicro,
              nodeAccountIDs: deps.nodeAccountIds,
              fy: pair.fy,
              expiresAt: new Date(issuedAt.getTime() + QUOTE_TTL_SECONDS * 1000)
            })
            .returning();
          return { decision, split, row };
        });
        if (!saved.row) throw new Error('[quote]: the quote was not saved');
        const { decision, split, row } = saved;

        const transfers = [
          {
            account: payTo.accountID,
            amount: split.receiverMicro.toString(),
            leg: 'consideration'
          },
          ...(split.reserveMicro > 0n
            ? [
                {
                  account: payer.data.reserveAccountId,
                  amount: split.reserveMicro.toString(),
                  leg: 'tds_reserve'
                }
              ]
            : [])
        ];
        const body: PaymentRequired = paymentRequiredSchema.parse({
          x402Version: X402_VERSION,
          error: 'PAYMENT-SIGNATURE header is required',
          resource,
          accepts: [
            {
              scheme: SCHEMES.koshaSplit,
              network: X402_NETWORKS[deps.network],
              asset: deps.settlementTokenId,
              payTo: payTo.accountID,
              amount: split.receiverMicro.toString(),
              maxTimeoutSeconds: QUOTE_TTL_SECONDS,
              extra: {
                feePayer: deps.feePayer,
                kosha: {
                  quoteId: row.id,
                  memo: quoteMemo(row.id),
                  expiresAt: row.expiresAt.toISOString(),
                  nodeAccountIds: deps.nodeAccountIds,
                  totalMicro: split.payerTotalMicro.toString(),
                  transfers,
                  tax: {
                    rulepack: decision.rulepack,
                    rateBps: decision.rateBps,
                    inrValuePaise: decision.valuePaise.toString(),
                    tdsMicroUsdc: decision.tdsMicroUsdc.toString(),
                    funding: 'payer_reserve',
                    reason: decision.reason,
                    flags: decision.flags
                  },
                  ...(payer.data.level === 0 && deps.registerUrl
                    ? { register: deps.registerUrl }
                    : {})
                }
              }
            }
          ]
        });

        // The quote must hold the same invariants Kosha Pay checks before signing
        const [entry] = body.accepts;
        if (entry?.scheme !== SCHEMES.koshaSplit || !checkSplitQuote(entry).ok) {
          throw new Error('[quote]: built a quote that fails its own split check');
        }
        return body;
      }
    );
  };
