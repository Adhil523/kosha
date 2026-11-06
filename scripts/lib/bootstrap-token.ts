import { type BootstrapContext, bootstrapLog } from './bootstrap-context';
import { TokenCreateTransaction, TokenSupplyType, TokenType } from '@hiero-ledger/sdk';

export const TOKEN_ENV_KEY = 'SETTLEMENT_TOKEN_ID';
export const TOKEN_DECIMALS = 6;
// 1,000,000 tUSDC in micro-units; Core is treasury and funds the demo agents from it
const INITIAL_SUPPLY_MICRO = 1_000_000_000_000n;

// Development settlement token (PROTOCOL §2). Skipped when SETTLEMENT_TOKEN_ID is set, including
// to Circle testnet USDC for the recorded demo (H5).
export const ensureSettlementToken = async (context: BootstrapContext): Promise<string> => {
  const existing = context.env[TOKEN_ENV_KEY]?.trim();
  if (existing) {
    bootstrapLog(`settlement token ${existing} already set`);
    return existing;
  }

  const create = new TokenCreateTransaction()
    .setTokenName('Kosha Test USDC')
    .setTokenSymbol('tUSDC')
    .setTokenType(TokenType.FungibleCommon)
    .setDecimals(TOKEN_DECIMALS)
    .setInitialSupply(INITIAL_SUPPLY_MICRO)
    .setSupplyType(TokenSupplyType.Infinite)
    .setTreasuryAccountId(context.coreId)
    .setSupplyKey(context.coreKey.publicKey)
    // Without an admin key a token can never be updated or deleted; Core, the operator, holds it
    .setAdminKey(context.coreKey.publicKey)
    .setTokenMemo('kosha dev settlement token');

  const created = await context.run(create);
  if (!created.ok) throw new Error(`token create failed: ${created.data.status}`);
  const tokenId = created.data.tokenId?.toString();
  if (!tokenId) throw new Error('token create returned no token ID');

  context.save({ [TOKEN_ENV_KEY]: tokenId });
  return tokenId;
};
