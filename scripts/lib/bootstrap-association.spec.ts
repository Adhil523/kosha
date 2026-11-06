/* eslint-disable @typescript-eslint/naming-convention -- the Mirror Node REST API names its fields in snake_case */
import type { TokenHolder } from './bootstrap-accounts';
import { ensureTokenHoldings } from './bootstrap-association';
import { fakeContext, receipt } from './bootstrap-fake';
import { PrivateKey, TokenAssociateTransaction, TransferTransaction } from '@hiero-ledger/sdk';
import { describe, expect, it } from 'vitest';

const TOKEN = '0.0.7007';
const agent: TokenHolder = {
  label: 'agent-resident',
  accountId: '0.0.2001',
  signers: [PrivateKey.generateED25519()],
  isAgent: true
};
const receiver: TokenHolder = {
  ...agent,
  label: 'receiver-in',
  accountId: '0.0.2002',
  isAgent: false
};

// Mirror answers: undefined means "not associated" (no token in the list), a number is the
// associated balance, and 'down' is an outage
const mirror =
  (balances: Record<string, number | 'down' | undefined>): typeof fetch =>
  async (input) => {
    const accountId = String(input).match(/accounts\/([\d.]+)\//)?.[1] ?? '';
    const balance = balances[accountId];
    if (balance === 'down') return new Response('{}', { status: 503 });
    if (balance === undefined) return Response.json({ tokens: [] });
    return Response.json({ tokens: [{ token_id: TOKEN, balance }] });
  };

describe('ensureTokenHoldings', () => {
  it('associates unassociated accounts and funds an empty agent', async () => {
    const context = fakeContext({}, () => receipt({}));
    await ensureTokenHoldings(context, [agent, receiver], TOKEN, mirror({}));
    const kinds = context.transactions.map((tx) => tx.constructor);
    expect(kinds).toEqual([
      TokenAssociateTransaction,
      TransferTransaction,
      TokenAssociateTransaction
    ]);
  });

  it('skips accounts already associated and agents already funded', async () => {
    const context = fakeContext({}, () => receipt({}));
    await ensureTokenHoldings(
      context,
      [agent, receiver],
      TOKEN,
      mirror({ '0.0.2001': 5, '0.0.2002': 0 })
    );
    expect(context.transactions).toHaveLength(0);
  });

  it('associates but never funds an agent whose balance the mirror could not read', async () => {
    const context = fakeContext({}, () => receipt({}));
    await ensureTokenHoldings(context, [agent], TOKEN, mirror({ '0.0.2001': 'down' }));
    const kinds = context.transactions.map((tx) => tx.constructor);
    expect(kinds).toEqual([TokenAssociateTransaction]);
  });

  it('treats an association the mirror has not seen yet as success', async () => {
    const context = fakeContext({}, (tx) =>
      tx instanceof TokenAssociateTransaction
        ? { ok: false, data: { status: 'TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT' } }
        : receipt({})
    );
    await expect(
      ensureTokenHoldings(context, [receiver], TOKEN, mirror({}))
    ).resolves.toBeUndefined();
  });

  it('reports, without failing, when Core holds too little to fund an agent', async () => {
    const context = fakeContext({}, () => ({
      ok: false,
      data: { status: 'INSUFFICIENT_TOKEN_BALANCE' }
    }));
    await expect(
      ensureTokenHoldings(context, [agent], TOKEN, mirror({ '0.0.2001': 0 }))
    ).resolves.toBeUndefined();
  });

  it('fails on any other association error', async () => {
    const context = fakeContext({}, () => ({ ok: false, data: { status: 'INVALID_SIGNATURE' } }));
    await expect(ensureTokenHoldings(context, [receiver], TOKEN, mirror({}))).rejects.toThrow(
      'INVALID_SIGNATURE'
    );
  });
});
