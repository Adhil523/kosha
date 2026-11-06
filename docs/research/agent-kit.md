# Hedera Agent Kit

**Answer:** The unscoped `hedera-agent-kit` package is deprecated at 3.8.2. Use v4, which is split into the scoped packages `@hashgraph/hedera-agent-kit` 4.2.0 (core, `AgentMode`, `Plugin`/`Tool`, built-in plugins at `/plugins`) and `@hashgraph/hedera-agent-kit-langchain` 2.1.0 (`HederaLangchainToolkit`). v4 runs on Zod 4, so there is no Zod 3/4 conflict with this repo. **Recommendation:** ship `kosha_paid_fetch` as an Agent Kit **plugin** (`koshaPayPlugin(pay)`). The `Tool` is a plain object, so this takes about as much code as the LangChain `tool()` version. It also qualifies `@kosha/pay` as a "Hedera Agent Kit plugin", works in the AI SDK, MCP and ElizaOS toolkits, and removes `@langchain/core` from `@kosha/pay`.

## Sources
- npm metadata (`npm view … version peerDependencies dependencies engines time`), checked 2026-11-06, for every package below
- https://github.com/hashgraph/hedera-agent-kit-js: `README.md`, `docs/{MIGRATION-v4,PLUGINS,HEDERAPLUGINS}.md`, `packages/core/src/shared/{configuration,tools,plugin,tool-discovery,api}.ts`, `packages/langchain/src/{toolkit,tool}.ts`, `examples/langchain-v1/plugin-tool-calling-agent.ts`, `examples/plugin/`
- https://docs.langchain.com/oss/javascript/langchain/agents, https://platform.claude.com/docs/en/about-claude/models/overview, https://developers.openai.com/api/docs/models

## Versions (checked 2026-11-06)
| Package | Version | Notes |
| --- | --- | --- |
| `hedera-agent-kit` | 3.8.2 | **Deprecated**: "use @hashgraph/hedera-agent-kit (v4)". Pins zod 3.25.76 and `@hashgraph/sdk` 2.80.0. Do not use. |
| `@hashgraph/hedera-agent-kit` | 4.2.0 (2026-10-28) | Dependencies: `zod` **4.6.7** (exact). Peer dependency: `@hiero-ledger/sdk ^2.90.1`. Exports `.`, `./plugins`, `./hooks`, `./policies` |
| `@hashgraph/hedera-agent-kit-langchain` | 2.1.0 (2026-10-28) | Peer dependencies: `langchain ^1.5.3`, `@langchain/core ^1.2.3`, `@hiero-ledger/sdk ^2.90.1`. Dependencies: zod 4.6.7, `@langchain/mcp-adapters` 1.1.3 |
| `@hiero-ledger/sdk` | 2.90.1 | Successor to `@hashgraph/sdk`, whose last release was 2.81.0 in March 2026 and which is not marked deprecated |
| `langchain` / `@langchain/core` | 1.6.2 / 1.3.5 | zod `^3.25.76 \|\| ^4`; Node >=20 |
| `@langchain/anthropic` / `@langchain/openai` | 1.6.0 / 1.8.0 | Peer dependency `@langchain/core ^1.3`. `@langchain/openai` needs Node >=22 |
| `zod` | 4.6.7 | Pin the repo to `4.6.7` so pnpm dedupes it with the kit (`Tool.parameters` is the kit's `z.ZodObject`) |

- **Module format:** dual ESM and CJS (`exports.import` → `.mjs`). Works from ESM; the upstream examples use `"type": "module"` and `tsx`.
- **Node:** the kit's `engines` field is `^22.23.4 || ^24.22.1 || >=26.12.1`. **This machine runs v24.15.0, which is below that range.** pnpm only warns unless `engine-strict` is set; bump Node to 24.22.1 or later anyway.
- **Peer dependencies:** the migration guide says LangChain is "bundled", but 2.1.0 declares `langchain` and `@langchain/core` as peer dependencies. Install both explicitly.

## API facts
- **Plugin type:** `{ name, version?, description?, tools: (context) => Tool[] }`. **Tool type:** `{ method, name, description, parameters: z.ZodObject, execute(client, context, params): Promise<any>, outputParser?, toolType?: 'query'|'transaction'|'other' }`.
  - The LangChain tool's name is `method`; `name` is only a display label.
  - `HederaAgentAPI.run` passes the return value of `execute` through `JSON.stringify` before the LLM sees it, so return an object.
- **Base classes:** `BaseTool`, `BaseQueryTool` and `BaseTransactionTool` are optional. They are needed only for hooks and policies; plain objects work fine.
- **Configuration:** `{ plugins?, tools?: string[] (allow-list of methods), context? }`.
  - **v4 has no implicit defaults:** with an empty `plugins` array the agent gets zero tools.
  - The `context` fields are `accountId?`, `accountPublicKey?`, `mode?`, `transactionStrategy?`, `mirrornodeService?` and `hooks?`.
- **`AgentMode`:** `AUTONOMOUS` (the default; the kit signs with the client operator), `RETURN_BYTES` (returns unsigned bytes; needs `context.accountId`), `CUSTOM_EXECUTE_TX` and `CUSTOM_RETURN_BYTES`.
- **Built-in plugins** (from `@hashgraph/hedera-agent-kit/plugins`):
  - Mutation plugins: `coreAccountPlugin`, `coreTokenPlugin`, `coreConsensusPlugin`, `coreEVMPlugin`.
  - Query plugins: `coreAccountQueryPlugin` (`get_hbar_balance_query_tool`, `get_account_query_tool`, `get_account_token_balances_query_tool`), `coreTokenQueryPlugin`, `coreConsensusQueryPlugin`, `coreEVMQueryPlugin`, `coreMiscQueriesPlugin`, `coreTransactionQueryPlugin`.
  - `allCorePlugins` loads all of them.
  - **The research agent should load only `coreAccountQueryPlugin`**, so it can check its HBAR and USDC balance. Load no mutation plugins: they would let the LLM move funds outside Kosha's policy.
- **LLM providers documented:** `@langchain/openai`, `@langchain/anthropic`, `@langchain/groq`, `@langchain/ollama`. The examples still use the outdated model IDs `gpt-4o-mini` and `claude-3-5-sonnet-20241022`.
- **Agent construction:** `createAgent({ model, tools, systemPrompt, checkpointer? })` from `langchain` v1. It replaces `createToolCallingAgent` + `AgentExecutor`. Its result is `{ messages }`. `model` may also be a `"provider:model"` string.
- **Model IDs:**
  - Anthropic: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` (also `claude-fable-5-1`). Default to `claude-sonnet-5-5`.
  - OpenAI: `gpt-6.1-terra` is a sensible cheap default, with `gpt-6-luna` the cheapest. How reliably either calls tools is **unconfirmed**.
  - Whether `@langchain/anthropic` 1.6.0 handles the 5.5 models' always-adaptive thinking cleanly is **unconfirmed**; smoke-test it.
- **Prior art:** `hak-mppx-hedera-plugin` 1.2.1 is a HAK-validated plugin that pays 402 APIs in USDC on Hedera using MPP, not x402. Expect judges to compare Kosha with it.

## Snippet
```ts
// packages/pay/src/agent-kit-plugin.ts: only a type import from the kit (make it an optional peer dependency)
import type { Plugin, Tool } from '@hashgraph/hedera-agent-kit';
import { z } from 'zod';
import type { KoshaPay } from './client.js';

const paidFetch = (pay: KoshaPay): Tool => ({
  method: 'kosha_paid_fetch', // this becomes the LangChain tool name
  name: 'Kosha paid fetch',
  description: 'Fetch a paid API; pays the x402 402 in USDC on Hedera with Indian TDS handled.',
  parameters: z.object({ url: z.url() }),
  execute: async (_client, _context, { url }: { url: string }) => {
    const res = await pay.fetch(url); // Kosha Pay signs with its own key; the kit client is unused
    return { raw: { body: await res.json(), receipt: pay.lastReceipt }, humanMessage: `Paid for ${url}` };
  },
});

export const koshaPayPlugin = (pay: KoshaPay): Plugin => ({ name: 'kosha-pay', version: '0.1.0', tools: () => [paidFetch(pay)] });

// apps/demo-agent/src/index.ts
import { Client, PrivateKey } from '@hiero-ledger/sdk';
import { AgentMode } from '@hashgraph/hedera-agent-kit';
import { coreAccountQueryPlugin } from '@hashgraph/hedera-agent-kit/plugins';
import { HederaLangchainToolkit } from '@hashgraph/hedera-agent-kit-langchain';
import { createAgent } from 'langchain';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { koshaPayPlugin } from '@kosha/pay';

const accountId = process.env.AGENT_ACCOUNT_ID!;
const client = Client.forTestnet().setOperator(accountId, PrivateKey.fromStringDer(process.env.AGENT_PRIVATE_KEY!));
const toolkit = new HederaLangchainToolkit({
  client,
  configuration: {
    plugins: [coreAccountQueryPlugin, koshaPayPlugin(pay)], // `pay` = the agent's KoshaPay instance
    context: { mode: AgentMode.AUTONOMOUS, accountId },
  },
});
const model = process.env.LLM_PROVIDER === 'anthropic'
  ? new ChatAnthropic({ model: 'claude-sonnet-5-5' })
  : new ChatOpenAI({ model: 'gpt-6.1-terra' });
const agent = createAgent({ model, tools: toolkit.getTools(), systemPrompt: 'Use kosha_paid_fetch to buy data.' });
const { messages } = await agent.invoke({
  messages: [{ role: 'user', content: 'Find GST details for these 5 companies and summarise.' }],
});
console.log(messages.at(-1)?.content);
```

## What this changes in the spec
- **Tech-stack table and Step 2 install:**
  - Replace `hedera-agent-kit` with `@hashgraph/hedera-agent-kit` and `@hashgraph/hedera-agent-kit-langchain`, plus `langchain`, `@langchain/core` and `@hiero-ledger/sdk`.
  - Add both `@langchain/anthropic` and `@langchain/openai`, selected at runtime by `LLM_PROVIDER`.
- **"Hedera Agent Kit tool" section:**
  - Write the tool as a kit `Plugin` registered through `configuration.plugins`, not a `tool()` placed next to `getTools()`.
  - B13 step 1 therefore builds the plugin as the primary form. A LangChain `tool()` wrapper becomes optional.
- **Zod:** the repo should use Zod **4.6.7**, matching the kit's exact pin. Write `z.url()` instead of `z.string().url()`, which is deprecated in Zod 4.
- **Agent API:** use `createAgent` from `langchain` v1, not `AgentExecutor`. Load explicit plugins (`coreAccountQueryPlugin` only), not `allCorePlugins` and not an empty array.
- **SDK split:** the kit's `Client` comes from `@hiero-ledger/sdk`, while the spec and `packages/hedera` use `@hashgraph/sdk`.
  - Keep the two separate inside the demo agent: `@kosha/pay` signs with its own key, and the kit client is used only for queries.
  - Optionally open an issue for Agent A proposing that the repo move to `@hiero-ledger/sdk`.
- **Runtime:** require Node >=24.22.1 (set `.nvmrc` and `engines`; that is root config, so open an issue for Agent A).
- **Unconfirmed:** that `@hiero-ledger/sdk` has `PrivateKey.fromStringDer` (as `@hashgraph/sdk` does), and that LangChain serializes the Zod 4 `z.url()` schema (JSON Schema `format: uri`) correctly for both providers.
