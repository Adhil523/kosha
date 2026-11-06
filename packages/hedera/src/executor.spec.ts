import { clientExecutor, UNKNOWN_EXECUTION_STATUS } from './executor';
import {
  AccountId,
  Client,
  PrecheckStatusError,
  Status,
  TransactionId,
  TransferTransaction
} from '@hiero-ledger/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

const precheckFailure = (status: Status) =>
  new PrecheckStatusError({
    status,
    transactionId: TransactionId.fromString('0.0.4000@1794911400.000000000'),
    nodeId: AccountId.fromString('0.0.3'),
    contractFunctionResult: null
  });

describe('clientExecutor', () => {
  const client = Client.forTestnet();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const executeFailing = async (status: Status) => {
    const transaction = new TransferTransaction();
    vi.spyOn(transaction, 'execute').mockRejectedValue(precheckFailure(status));
    return clientExecutor(client)(transaction);
  };

  it('keeps the status of a precheck failure', async () => {
    expect(await executeFailing(Status.InsufficientPayerBalance)).toEqual({
      ok: false,
      data: { status: 'INSUFFICIENT_PAYER_BALANCE', receipt: null }
    });
  });

  it('reports a duplicate transaction as an unknown outcome, since it may have reached consensus', async () => {
    expect(await executeFailing(Status.DuplicateTransaction)).toEqual({
      ok: false,
      data: { status: UNKNOWN_EXECUTION_STATUS, receipt: null }
    });
  });
});
