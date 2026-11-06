import { fakeContext, receipt } from './bootstrap-fake';
import { ensureSettlementToken, TOKEN_DECIMALS } from './bootstrap-token';
import { TokenCreateTransaction } from '@hiero-ledger/sdk';
import { describe, expect, it } from 'vitest';

describe('ensureSettlementToken', () => {
  it('keeps a token already in the env file, such as Circle USDC', async () => {
    const context = fakeContext({ SETTLEMENT_TOKEN_ID: '0.0.429274' }, () => receipt({}));
    expect(await ensureSettlementToken(context)).toBe('0.0.429274');
    expect(context.transactions).toHaveLength(0);
  });

  it('creates 6-decimal tUSDC with Core as treasury and admin, and saves its ID', async () => {
    const context = fakeContext({ SETTLEMENT_TOKEN_ID: '' }, () =>
      receipt({ tokenId: '0.0.7007' })
    );
    expect(await ensureSettlementToken(context)).toBe('0.0.7007');
    expect(context.saved).toEqual({ SETTLEMENT_TOKEN_ID: '0.0.7007' });

    const [create] = context.transactions;
    expect(create).toBeInstanceOf(TokenCreateTransaction);
    if (!(create instanceof TokenCreateTransaction)) return;
    expect(create.tokenSymbol).toBe('tUSDC');
    expect(create.decimals?.toNumber()).toBe(TOKEN_DECIMALS);
    expect(create.treasuryAccountId?.toString()).toBe('0.0.1001');
    expect(create.adminKey?.toString()).toBe(context.coreKey.publicKey.toString());
  });

  it('fails loudly when the network rejects the create', async () => {
    const context = fakeContext({}, () => ({ ok: false, data: { status: 'INSUFFICIENT_TX_FEE' } }));
    await expect(ensureSettlementToken(context)).rejects.toThrow('INSUFFICIENT_TX_FEE');
    expect(context.saved).toEqual({});
  });
});
