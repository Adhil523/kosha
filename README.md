# kosha
Kosha is an x402 facilitator on Hedera that works out the tax on every payment and withholds it in the same transaction.

## First settled payment (testnet)

On 6 November 2026 an agent paid the Indian demo API through Kosha Pay (`pnpm pay-once`). The pair
had already crossed the ₹10,000 threshold, so the API received exactly its price, and 1% TDS went
to the agent's own 2-of-2 reserve. Both legs moved in one atomic Hedera transaction.

| | |
| --- | --- |
| Transaction | [`0.0.11341449@1793987971.680000000`](https://hashscan.io/testnet/transaction/0.0.11341449-1793987971-680000000) |
| Memo | `kosha:q_w7813xvnr9jqkt8w140p5nsd` |
| Payer, `agent-resident` | [`0.0.11342842`](https://hashscan.io/testnet/account/0.0.11342842): −0.101019 tUSDC |
| API, `receiver-in` | [`0.0.11342839`](https://hashscan.io/testnet/account/0.0.11342839): +0.100000 tUSDC (`consideration`) |
| Agent's TDS reserve | [`0.0.11342843`](https://hashscan.io/testnet/account/0.0.11342843): +0.001019 tUSDC (`tds_reserve`) |
| Fee payer, Kosha Core | [`0.0.11341449`](https://hashscan.io/testnet/account/0.0.11341449) |
| HCS record | [topic `0.0.11342856`, message #6](https://hashscan.io/testnet/topic/0.0.11342856), with the pair's running total (`agg`) |

The TDS is 1% of ₹8.84, worked out in whole paise and rounded up, so it never under-deducts.
Below the threshold the same call settles with one leg and no TDS
([example](https://hashscan.io/testnet/transaction/0.0.11341449-1793987958-456000000)).
