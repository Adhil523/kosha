# Hedera testnet USDC

**Answer:** Circle testnet USDC is HTS token **`0.0.429274`** (USD Coin, `USDC`, 6 decimals, no KYC key, freeze default off, no custom fees), so transfers work once the receiver is associated. Circle's faucet gives **20 USDC per address every 2 hours** and takes only a `0.0.x` account ID. That is too little for burst runs, so the `tUSDC` dev path stays. Note that `@hashgraph/sdk` stopped at 2.81.0. The SDK now ships as `@hiero-ledger/sdk`.

## Sources
- https://developers.circle.com/stablecoins/usdc-contract-addresses (Hedera mainnet `0.0.456858`, testnet `0.0.429274`)
- https://faucet.circle.com/ (live page plus its JS bundle: "Send 20 USDC", "One request per pairing of asset and test network every 2 hours", Hedera address validator `/^0\.0\.\d+$/`)
- https://testnet.mirrornode.hedera.com/api/v1/tokens/0.0.429274, `.../network/exchangerate`; mainnet mirror `/tokens/0.0.456858`
- https://docs.hedera.com/hedera/networks/mainnet/fees ; https://docs.hedera.com/hedera/core-concepts/accounts/account-properties ; https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/associate-tokens-to-an-account
- https://docs.hedera.com/hedera/getting-started-hedera-native-developers/create-an-account ; https://docs.hedera.com/learn/getting-started/testnet-faucet (via search summary)
- unpkg `.d.ts`/`.cjs` of `@hashgraph/sdk@2.81.0` and `@hiero-ledger/sdk@2.90.1` (`AbstractTokenTransferTransaction`, `AccountCreateTransaction`, `TokenCreateTransaction`, `Status`, README)

## Versions (checked 2026-11-06)
- **Testnet USDC `0.0.429274`** (mirror): name `USD Coin`, symbol `USDC`, decimals `6`, type `FUNGIBLE_COMMON`, treasury `0.0.5176`, supply `INFINITE`. `kyc_key: null`, `freeze_key` set but `freeze_default: false`, `pause_key: null` (`NOT_APPLICABLE`), `custom_fees` empty, `wipe_key: null`. New associated accounts are unfrozen and need no KYC grant.
- **Mainnet USDC `0.0.456858`**: same name, symbol and decimals, also no KYC key and no custom fees (reference only).
- **Circle faucet**: Hedera Testnet listed; 20 USDC per request; 1 request per address per network per 2 h (FAQ wording: "per address and per blockchain"). Input must match `0.0.N`, so EVM addresses are rejected. Association required first: **unconfirmed** on the page, but HTS rejects the transfer unless the account is associated or has a free auto-association slot.
- **SDK**: `@hashgraph/sdk` **2.81.0** (latest, 2026-03-13; its README already says `npm install @hiero-ledger/sdk`). **`@hiero-ledger/sdk` 2.90.1** (2026-10-15) has the same API and namespace. Node >= 18.
- **API**: `addTokenTransfer(tokenId, accountId, amount: number | Long | BigNumber | bigint)` (bigint accepted). `addTokenTransferWithDecimals(..., decimals)` asserts decimals on-chain. `AccountCreateTransaction.setKey` is deprecated in favour of `setKeyWithoutAlias`/`setECDSAKeyWithAlias`. `setMaxAutomaticTokenAssociations(number | Long)`. `TokenAssociateTransaction.setAccountId/setTokenIds` is unchanged.
- **Status codes**: `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT` (184), `NO_REMAINING_AUTOMATIC_ASSOCIATIONS` (262), `ACCOUNT_FROZEN_FOR_TOKEN` (165), `TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT` (association is not idempotent).
- **Association rules**: the associated account's key must sign, plus the fee payer. For a `KeyList` 2-of-2 account, both keys must sign. `maxAutoAssociations`: `0` = manual only, `N>0` = N slots (the sender pays the slot fee and the first rent), `-1` = unlimited (HIP-904). `-1` is the default only for *auto-created* (alias/hollow) accounts. The SDK leaves the field unset on `AccountCreateTransaction`, so the network default is 0 (from the SDK source; proto default, not stated in the docs).
- **Fees (USD base, docs)**: CryptoCreate $0.05; TokenAssociate $0.05; TokenCreate $1.00; TokenMint $0.001; token transfer $0.001; TopicCreate about $0.01. At testnet rate 30000 HBAR = 204153 cents (**about $0.068/HBAR**), that is about 0.73, 0.73, 14.7, 0.015 and 0.015 HBAR. Multisig signatures add small extras.
- **HBAR faucets**: the portal creates the account with 1000 HBAR and tops it up to 1000 (not +1000) once per 24 h on request. The anonymous faucet and faucet API give 100 HBAR per 24 h. Testnet resets roughly quarterly and wipes accounts and tokens; `0.0.429274` has survived since 2024-02.

## Snippet
```ts
import { AccountCreateTransaction, Client, Hbar, KeyList, PrivateKey, TokenAssociateTransaction,
  TokenCreateTransaction, TokenSupplyType, TokenType, TransferTransaction } from '@hiero-ledger/sdk'; // or @hashgraph/sdk@2.81.0

const client = Client.forTestnet().setOperator(process.env.CORE_ACCOUNT_ID!, PrivateKey.fromStringDer(process.env.CORE_PRIVATE_KEY!));
client.setDefaultMaxTransactionFee(new Hbar(30));
const coreKey = client.operatorPublicKey!;

// 1. tUSDC: 6 decimals, Core is treasury; supply key optional (omit = fixed supply).
const tok = await (await new TokenCreateTransaction().setTokenName('Kosha Test USDC').setTokenSymbol('tUSDC')
  .setTokenType(TokenType.FungibleCommon).setDecimals(6).setInitialSupply(1_000_000_000_000n) // 1M tUSDC
  .setSupplyType(TokenSupplyType.Infinite).setTreasuryAccountId(client.operatorAccountId!).setSupplyKey(coreKey)
  .execute(client)).getReceipt(client);
const tokenId = tok.tokenId!;

// 2. Agent account (Core pays the fee; 0 HBAR balance is fine because Core pays every later fee too).
const agentKey = PrivateKey.generateED25519();
const agentId = (await (await new AccountCreateTransaction().setKeyWithoutAlias(agentKey.publicKey)
  .setInitialBalance(new Hbar(0)).execute(client)).getReceipt(client)).accountId!;

// 3. Associate: the account key signs; Core (operator) pays and signs automatically.
await (await (await new TokenAssociateTransaction().setAccountId(agentId).setTokenIds([tokenId])
  .freezeWith(client).sign(agentKey)).execute(client)).getReceipt(client);

// 4. Escrow: 2-of-2 KeyList (Core + compliance). Association needs BOTH signatures.
const complianceKey = PrivateKey.fromStringDer(process.env.COMPLIANCE_PRIVATE_KEY!);
const escrowId = (await (await new AccountCreateTransaction()
  .setKeyWithoutAlias(new KeyList([coreKey, complianceKey.publicKey], 2)).execute(client)).getReceipt(client)).accountId!;
await (await (await new TokenAssociateTransaction().setAccountId(escrowId).setTokenIds([tokenId])
  .freezeWith(client).sign(complianceKey)).execute(client)).getReceipt(client); // Core's half = operator signature

// 5. Fund the agent, then settle: payer -> API (price) + payer -> escrow (TDS), integer micro-units as bigint.
await (await new TransferTransaction().addTokenTransfer(tokenId, client.operatorAccountId!, -50_000_000n)
  .addTokenTransfer(tokenId, agentId, 50_000_000n).execute(client)).getReceipt(client);
const price = 98_000n, tds = 2_000n, receiverId = escrowId; // stand-in receiver
await (await (await new TransferTransaction().addTokenTransfer(tokenId, agentId, -(price + tds))
  .addTokenTransfer(tokenId, receiverId, price).addTokenTransfer(tokenId, escrowId, tds)
  .setTransactionMemo('kosha:q_123').freezeWith(client).sign(agentKey)).execute(client)).getReceipt(client);
```
The operator signature satisfies Core's key inside the KeyList, so a separate sign is needed only if Core is not the operator.

## What this changes in the spec
- **Env var**: spec Step 2 uses `USDC_TOKEN_ID`; PROTOCOL/AGENT_A/AGENT_B use `SETTLEMENT_TOKEN_ID`. Use **`SETTLEMENT_TOKEN_ID`** only, and drop `USDC_TOKEN_ID` from `.env.example` (or document it as an alias). Recorded-demo value: `0.0.429274`.
- **Faucet forces the tUSDC dev path**: 20 USDC per 2 h per account gives about 240 USDC/day per agent account. That is enough for the recorded demo (4 agents, sub-dollar prices), not for load or burst tests. For H5, request the faucet into **Core** (`0.0.x` form) and fan out to the agents, or request per agent. Either way, **associate first**.
- **Association**: keep explicit `TokenAssociateTransaction` in bootstrap with `maxAutomaticTokenAssociations` left at 0. That makes failures deterministic and keeps auto-association slot fees out of the settlement transaction, which `verify()` must keep tight. Make it idempotent: check `GET /api/v1/accounts/{id}/tokens?token.id={token}` first, or treat `TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT` as success. Re-run it when `SETTLEMENT_TOKEN_ID` changes (H5). The escrow association needs the compliance key at bootstrap time.
- **Settlement failure mapping**: an unassociated receiver or escrow returns `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`. Surface it as a config error, not a payer error. Use `addTokenTransferWithDecimals(..., 6)` in `settle()` to catch a wrong-token or wrong-decimals config on-chain.
- **Amounts**: the SDK accepts `bigint` directly, so keep micro-units as `bigint` end to end (no `Long` conversion).
- **SDK package**: the spec says `@hashgraph/sdk` (frozen at 2.81.0). Prefer `@hiero-ledger/sdk@2.90.1` (same API). `hedera-agent-kit` and `standards-sdk` still pull `@hashgraph/sdk ^2.78`, so if both are installed, avoid passing SDK objects across the two packages (unconfirmed whether `instanceof` checks break).
- **HBAR budget**: 8 accounts (about 5.8) + 8 associations (about 5.8, roughly 2x on the H5 re-run) + tUSDC create (about 14.7) + 2 topics (about 0.3) + transfers gives **about 30 HBAR per bootstrap**, well under the 1000 HBAR portal balance. Bootstrap's client needs `setDefaultMaxTransactionFee(new Hbar(30))` or TokenCreate can hit `INSUFFICIENT_TX_FEE`. Keep that separate from `MAX_TX_FEE_HBAR`, the verifier's cap on the `maxTransactionFee` of a settlement Core pays for: it should stay small (about 1–2 HBAR; a token transfer costs about 0.015). Agents need no HBAR for payments, because Core pays settlement fees, but each needs about 5 HBAR for its HCS-11 profile inscription (see `hcs-14.md`).
- **Testnet resets** wipe `tUSDC` and the accounts, so bootstrap must be re-runnable end to end.
