import {
  type AgentEnv,
  budgetCaps,
  demoPrompt,
  payOptions,
  providerApiKey,
  readAgentEnv
} from './config';
import { createChatModel } from './model';
import { finalText, readReceipts } from './transcript';
import { AgentMode } from '@hashgraph/hedera-agent-kit';
import { HcsAuditTrailHook } from '@hashgraph/hedera-agent-kit/hooks';
import { coreAccountQueryPlugin } from '@hashgraph/hedera-agent-kit/plugins';
import { HederaLangchainToolkit } from '@hashgraph/hedera-agent-kit-langchain';
import { Client } from '@hiero-ledger/sdk';
import { parsePrivateKey } from '@kosha/hedera/client';
import { KOSHA_PAID_FETCH, KoshaBudgetPolicy, koshaPayPlugin } from '@kosha/pay/agent-kit-plugin';
import { createKoshaPay } from '@kosha/pay/kosha-pay';
import { loadEnv } from '@kosha/shared/env';
import { createAgent } from 'langchain';

// `pnpm --filter @kosha/demo-agent start` (B13): a research agent that buys GST data through
// Kosha. It has Kosha Pay and read-only account queries, and no tool that can move funds any other
// way. The kit runs the budget policy between quote and payment, and the HCS audit hook logs every
// paid call, refused ones included.

const SYSTEM_PROMPT = [
  'You are a research agent for an Indian compliance team.',
  'Paid data APIs answer HTTP 402; use kosha_paid_fetch for them, one call per lookup.',
  'Kosha Pay pays in USDC on Hedera and reserves any Indian TDS on top of the price.',
  'If a payment is blocked by a policy, say so and carry on with what you have.',
  'Never try to move funds any other way.'
].join(' ');

const operatorClient = (env: AgentEnv, accountId: string, privateKey: string): Client => {
  const key = parsePrivateKey(privateKey);
  if (!key.ok) throw new Error(`the key for ${accountId} is not a usable private key`);
  return Client.forName(env.HEDERA_NETWORK).setOperator(accountId, key.data);
};

const main = async (): Promise<void> => {
  const loaded = loadEnv();
  if (!loaded.ok) throw new Error(`no pnpm workspace found above ${loaded.data.searchedFrom}`);
  const read = readAgentEnv(process.env);
  if (!read.ok) throw new Error(`set these env keys: ${read.data.keys.join(', ')}`);
  const env = read.data;

  const pay = createKoshaPay(payOptions(env));
  // The kit's client: read-only queries for the agent's own account
  const client = operatorClient(env, env.AGENT_RESIDENT_ACCOUNT_ID, env.AGENT_RESIDENT_PRIVATE_KEY);
  // The audit topic's submit key is Core's, so Core signs (and pays for) the audit messages
  const auditClient = operatorClient(env, env.CORE_ACCOUNT_ID, env.CORE_PRIVATE_KEY);

  const toolkit = new HederaLangchainToolkit({
    client,
    configuration: {
      plugins: [coreAccountQueryPlugin, koshaPayPlugin(pay)],
      context: {
        mode: AgentMode.AUTONOMOUS,
        accountId: env.AGENT_RESIDENT_ACCOUNT_ID,
        hooks: [
          new KoshaBudgetPolicy(budgetCaps(env)),
          new HcsAuditTrailHook([KOSHA_PAID_FETCH], env.HCS_AUDIT_TOPIC, auditClient)
        ]
      }
    }
  });
  const agent = createAgent({
    model: createChatModel(env.LLM_PROVIDER, providerApiKey(env), env.LLM_MODEL),
    tools: toolkit.getTools(),
    systemPrompt: SYSTEM_PROMPT
  });

  const prompt = demoPrompt(env);
  console.info(`[demo-agent]: ${prompt}`);
  try {
    const { messages } = await agent.invoke({ messages: [{ role: 'user', content: prompt }] });
    for (const receipt of readReceipts(messages)) console.info(`[demo-agent]: ${receipt}`);
    console.info(`[demo-agent]: answer\n${finalText(messages)}`);
  } finally {
    client.close();
    auditClient.close();
  }
};

main().catch((error: unknown) => {
  console.error('[demo-agent]: failed', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
