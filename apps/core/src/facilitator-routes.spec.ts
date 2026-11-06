import { buildApp } from './app';
import type { DbHandle } from './db/client';
import { testDb } from './db/test-db';
import { facilitatorRoutes } from './facilitator-routes';
import { payloadFor, RECEIVER_AUTH, seedQuotedPayment, verifyDeps } from './payment.fixture';
import { PrivateKey } from '@hiero-ledger/sdk';
import type { Executed } from '@kosha/hedera/executor';
import { QUOTE, signedVariant } from '@kosha/hedera/transfer-verifier.fixture';
import { X402_VERSION } from '@kosha/shared/headers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('POST /v1/verify and /v1/settle', () => {
  let handle: DbHandle;
  let executed: Executed;

  const appFor = () =>
    buildApp({
      logger: false,
      routes: [
        facilitatorRoutes({
          ...verifyDeps(handle.db),
          network: 'testnet',
          ledger: { pairSecret: 's', rulepackHash: 'cd'.repeat(32), paymentsTopicId: '0.0.7100' },
          execute: async () => executed,
          reconcile: async () => 'unknown'
        })
      ]
    });
  const call = async (
    path: string,
    transaction: string,
    headers: Record<string, string> = RECEIVER_AUTH
  ) =>
    appFor().inject({
      method: 'POST',
      url: path,
      headers,
      payload: {
        x402Version: X402_VERSION,
        paymentPayload: payloadFor(transaction),
        paymentRequirements: QUOTE
      }
    });

  beforeEach(async () => {
    handle = await testDb();
    await seedQuotedPayment(handle.db);
    executed = { ok: true, data: { topicSequenceNumber: null, accountId: null, scheduleId: null } };
  });

  afterEach(async () => {
    await handle.close();
  });

  it('answers 401 without the receiver API key', async () => {
    const response = await call('/v1/verify', await signedVariant(), {});
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized' });
  });

  it('verifies, with the standard reason and the Kosha code on failure', async () => {
    const valid = await call('/v1/verify', await signedVariant());
    expect(valid.json()).toEqual({
      isValid: true,
      payer: '0.0.6001',
      extra: { kosha: { quoteId: 'q_7f3a' } }
    });

    const forged = await call(
      '/v1/verify',
      await signedVariant({ key: PrivateKey.generateED25519() })
    );
    expect(forged.json()).toEqual({
      isValid: false,
      invalidReason: 'invalid_exact_hedera_payload_signature_invalid',
      extra: { kosha: { quoteId: 'q_7f3a', errorCode: 'bad_signature' } }
    });
  });

  it('settles with the HashScan link and the TDS, then refuses a replay', async () => {
    const signed = await signedVariant();
    const settled = await call('/v1/settle', signed);
    expect(settled.statusCode).toBe(200);
    expect(settled.json()).toEqual({
      success: true,
      payer: '0.0.6001',
      transaction: '0.0.4000@1793961000.000000000',
      network: 'hedera:testnet',
      amount: '100000',
      extensions: {
        kosha: {
          hashscanUrl: 'https://hashscan.io/testnet/transaction/0.0.4000-1793961000-000000000',
          hcsSequence: null,
          tdsMicroUsdc: '1019'
        }
      }
    });

    const replayed = await call('/v1/settle', signed);
    expect(replayed.json()).toMatchObject({ success: false, errorReason: 'replay' });
  });

  it('puts the Kosha code in errorReason when the network rejects the settlement', async () => {
    executed = { ok: false, data: { status: 'INSUFFICIENT_TOKEN_BALANCE', receipt: null } };
    const response = await call('/v1/settle', await signedVariant());
    expect(response.json()).toEqual({
      success: false,
      errorReason: 'settlement_failed',
      errorMessage: 'network status INSUFFICIENT_TOKEN_BALANCE',
      transaction: '0.0.4000@1793961000.000000000',
      network: 'hedera:testnet'
    });
  });
});
