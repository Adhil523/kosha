import type { RegisterRoutes } from './app';
import { authenticateReceiver } from './auth';
import {
  type SettleDeps,
  type SettledPayment,
  type SettleFailure,
  settlePayment
} from './payment-settle';
import { type PaymentFailure, verifyPayment } from './payment-verify';
import { errorResponseSchema, toX402Reason } from '@kosha/shared/error-codes';
import {
  facilitatorRequestSchema,
  type VerifyResponse,
  verifyResponseSchema
} from '@kosha/shared/facilitator-api';
import { X402_NETWORKS } from '@kosha/shared/headers';
import { type HederaNetwork, quoteIdSchema, transactionIdSchema } from '@kosha/shared/ids';
import { hashscanTransaction } from '@kosha/shared/links';
import { type SettlementResponse, settlementResponseSchema } from '@kosha/shared/x402-payment';

export type FacilitatorRouteDeps = SettleDeps & {
  network: HederaNetwork;
  // Tells the receiver's Console about the payment (A13's stream)
  announce?: (settled: SettledPayment) => Promise<void>;
};

// A failed verify carries the standard x402 reason, and the Kosha code in extra.kosha
const invalidPayment = ({ code, quoteId }: PaymentFailure): VerifyResponse => ({
  isValid: false,
  invalidReason: toX402Reason(code),
  ...(quoteId ? { extra: { kosha: { quoteId, errorCode: code } } } : {})
});

// A failed settle carries the Kosha code itself in errorReason (docs/core-api.md)
const failedSettlement = (
  network: HederaNetwork,
  { code, transactionId, status }: SettleFailure
): SettlementResponse => ({
  success: false,
  errorReason: code,
  ...(status ? { errorMessage: `network status ${status}` } : {}),
  transaction: transactionIdSchema.safeParse(transactionId).data ?? '',
  network: X402_NETWORKS[network]
});

export const facilitatorRoutes =
  (deps: FacilitatorRouteDeps): RegisterRoutes =>
  (app) => {
    app.post(
      '/v1/verify',
      {
        schema: {
          body: facilitatorRequestSchema,
          response: { 200: verifyResponseSchema, 401: errorResponseSchema }
        }
      },
      async (request, reply) => {
        const auth = await authenticateReceiver(deps.db, request);
        if (!auth.ok) return reply.status(401).send(auth.data);

        const result = await verifyPayment(deps, auth.data.id, request.body.paymentPayload);
        if (!result.ok) return invalidPayment(result.data);
        const { payer, quote } = result.data;
        return {
          isValid: true,
          payer,
          extra: { kosha: { quoteId: quoteIdSchema.parse(quote.id) } }
        };
      }
    );

    app.post(
      '/v1/settle',
      {
        schema: {
          body: facilitatorRequestSchema,
          response: { 200: settlementResponseSchema, 401: errorResponseSchema }
        }
      },
      async (request, reply) => {
        const auth = await authenticateReceiver(deps.db, request);
        if (!auth.ok) return reply.status(401).send(auth.data);

        const result = await settlePayment(deps, auth.data.id, request.body.paymentPayload);
        if (!result.ok) return failedSettlement(deps.network, result.data);

        if (deps.announce) {
          // The payment is settled and recorded either way; a missed event costs only the live feed
          try {
            await deps.announce(result.data);
          } catch (error) {
            request.log.error({ err: error }, '[stream]: could not announce a settlement');
          }
        }

        const { payer, quote, transactionId } = result.data;
        const settled = transactionIdSchema.parse(transactionId);
        return settlementResponseSchema.parse({
          success: true,
          payer,
          transaction: settled,
          network: X402_NETWORKS[deps.network],
          amount: quote.priceMicro.toString(),
          extensions: {
            kosha: {
              hashscanUrl: hashscanTransaction(deps.network, settled),
              // The outbox publishes the HCS record moments later; the ledger shows its sequence
              hcsSequence: null,
              tdsMicroUsdc: quote.tdsMicro.toString()
            }
          }
        });
      }
    );
  };
