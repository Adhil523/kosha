import { coreClientFromEnv } from './client';
import { clientExecutor } from './executor';
import { createMirrorClient } from './mirror';
import { createReserveAccount } from './reserve';
import { Hbar, PrivateKey, TransferTransaction } from '@hiero-ledger/sdk';
import { loadEnv } from '@kosha/shared/env';
import { describe, expect, it } from 'vitest';

// Opt-in: KOSHA_TESTNET=1 pnpm --filter @kosha/hedera test. Spends about 1 testnet HBAR from
// Core's account and needs CORE_*, SETTLEMENT_TOKEN_ID (Core holds it), MIRROR_URL and
// MAX_TX_FEE_HBAR in the shared env.
const RUN = process.env.KOSHA_TESTNET === '1';
const MIRROR_WAIT_MS = 20_000;

const pollUntil = async <T>(
  probe: () => Promise<T | null>,
  timeoutMs: number
): Promise<T | null> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await probe();
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return null;
};

describe.skipIf(!RUN)('testnet smoke: reserve account', () => {
  it('creates a reserve, sees it on the Mirror Node, and auto-associates on the first credit', async () => {
    loadEnv();
    const built = coreClientFromEnv();
    if (!built.ok)
      throw new Error(`[smoke]: ${built.data.reason} ${built.data.fields?.join(',') ?? ''}`);
    const { client, operatorId, operatorKey } = built.data;
    const execute = clientExecutor(client);
    const token = process.env.SETTLEMENT_TOKEN_ID ?? '';
    const feeCap = process.env.MAX_TX_FEE_HBAR ?? '2';

    try {
      const agentKey = PrivateKey.generateED25519().publicKey;
      const reserve = await createReserveAccount(execute, {
        agentKey,
        coreKey: operatorKey.publicKey
      });
      expect(reserve.ok).toBe(true);
      if (!reserve.ok) return;

      const mirror = createMirrorClient(process.env.MIRROR_URL ?? '');
      const key = await pollUntil(async () => {
        const result = await mirror.accountKey(reserve.data.accountId);
        return result.ok ? result.data : null;
      }, MIRROR_WAIT_MS);
      expect(key?.type).toBe('ProtobufEncoded');

      // The first credit uses the automatic association slot; Core pays, under the fee cap
      const credit = await execute(
        new TransferTransaction()
          .addTokenTransfer(token, operatorId, -1n)
          .addTokenTransfer(token, reserve.data.accountId, 1n)
          .setMaxTransactionFee(new Hbar(feeCap))
      );
      expect(credit).toMatchObject({ ok: true });
      console.info(`[smoke]: reserve ${reserve.data.accountId} created and credited`);
    } finally {
      client.close();
    }
  }, 60_000);
});
