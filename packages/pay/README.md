# @kosha/pay

A drop-in `fetch` for AI agents that pays x402 `402 Payment Required` responses in USDC on
Hedera, with Indian TDS reserved in the agent's own account. Pay checks every quote against the
owner's spending rules and signs exactly the quoted transfers, nothing else.

```ts
import { createKoshaPay } from '@kosha/pay';

const pay = createKoshaPay({
  network: 'testnet',
  accountId: process.env.AGENT_ACCOUNT_ID ?? '',
  privateKey: process.env.AGENT_PRIVATE_KEY ?? '',
  reserveAccountId: process.env.AGENT_RESERVE_ID ?? '', // the agent's own 2-of-2 TDS reserve
  asset: process.env.SETTLEMENT_TOKEN_ID ?? '',
  trustedFacilitators: [process.env.CORE_ACCOUNT_ID ?? ''],
  policy: {
    perPaymentUsdc: '0.50',
    dailyUsdc: '5',
    fyBudgetUsdc: '200',
    allowlist: ['api.demo-in.dev'],
    onThreshold: 'warn'
  }
});

const response = await pay.fetch('https://api.demo-in.dev/v1/gst-lookup?gstin=29AAKCK4821M1ZQ');
console.info(await response.json(), pay.lastReceipt); // { txId, hashscanUrl, tdsMicroUsdc, … }
```

## What Pay checks before it fetches

The URL must be `http` or `https`, its host must be on the allowlist, and it must not be a
private, loopback or link-local IP address (cloud metadata included), even if allowlisted. Pay
does not follow redirects unless the caller's `init` asks it to, since the target was never
checked. A refused URL is never contacted: `pay.fetch()` returns `Response.error()` (status 0) and
`pay.lastError` says why.

## What Pay checks before it signs

- The rule pack is accepted, and the all-in total (price plus TDS) fits the per-payment, daily
  and financial-year caps, counting payments still in flight.
- The `kosha-split` quote: `amount` is the consideration leg to `payTo`, the legs sum to the total,
  the memo names the quote, and the TDS leg credits **this agent's own reserve**.
- The token, network and fee payer (one of `trustedFacilitators`), and that the quote hasn't expired.

When Pay won't pay, `pay.fetch()` returns the server's 402 unchanged and `pay.lastError` says why.

## Two steps

`pay.prepare(url)` fetches and, on a 402, checks and signs the quote without sending it. The
payment counts against the caps from that moment, so concurrent calls can't all fit under the
same headroom. `pay.complete(payment)` retries once with `PAYMENT-SIGNATURE`; if the server
refuses it, the caps are freed again. A payment you decide not to send must go to
`pay.release(payment)`, or it stays counted. The Agent Kit plugin uses the two steps so a budget
policy can run between them. Both return results (`{ ok, data }`) rather than throwing.

## With Hedera Agent Kit

`koshaPayPlugin(pay)` from `@kosha/pay/agent-kit-plugin` adds one transaction tool,
`kosha_paid_fetch_tool` (`KOSHA_PAID_FETCH_TOOL`). `KoshaBudgetPolicy` caps it between quote and
payment. The tool pays only in `AgentMode.AUTONOMOUS`: Pay signs the payer's half and the API's
facilitator submits it, so there are no bytes for `RETURN_BYTES` to return and nothing for a
custom strategy to execute. In any other mode it refuses without fetching.

The caps cover this tool only. A plugin with a raw transfer tool, such as `coreTokenPlugin`'s
`transfer_fungible_token_tool`, running with the same operator account can move the same USDC
with no cap at all (so can `coreAccountPlugin`'s `approve_token_allowance_tool`). Load only the
tools you need, or reject the ones that move funds:

```ts
import { AgentMode } from '@hashgraph/hedera-agent-kit';
import { RejectToolPolicy } from '@hashgraph/hedera-agent-kit/policies';
import { coreTokenPlugin, coreTokenPluginToolNames } from '@hashgraph/hedera-agent-kit/plugins';
import { HederaLangchainToolkit } from '@hashgraph/hedera-agent-kit-langchain';
import { KoshaBudgetPolicy, koshaPayPlugin } from '@kosha/pay/agent-kit-plugin';

const toolkit = new HederaLangchainToolkit({
  client, // the account Pay pays from
  configuration: {
    plugins: [koshaPayPlugin(pay), coreTokenPlugin],
    // Or list only the tools to load: tools: [KOSHA_PAID_FETCH_TOOL, ...]
    context: {
      mode: AgentMode.AUTONOMOUS,
      hooks: [
        new KoshaBudgetPolicy({ dailyMicro: 5_000_000n }),
        new RejectToolPolicy([
          coreTokenPluginToolNames.TRANSFER_FUNGIBLE_TOKEN_TOOL,
          coreTokenPluginToolNames.TRANSFER_FUNGIBLE_TOKEN_WITH_ALLOWANCE_TOOL,
          coreTokenPluginToolNames.AIRDROP_FUNGIBLE_TOKEN_TOOL
        ])
      ]
    }
  }
});
```

## With a stock x402 client

`koshaSplitScheme(config)` from `@kosha/pay/kosha-split-scheme` registers the same signing into
`@x402/core`'s `x402Client`: `client.register('hedera:testnet', koshaSplitScheme(config))`.

## Build

`pnpm --filter @kosha/pay build` writes ESM, CJS and type declarations to `dist/`, with
`@kosha/shared`, `@kosha/hedera` and `@kosha/tax-engine` bundled in.
