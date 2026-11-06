import { budgetCaps, demoPrompt, payOptions, readAgentEnv } from './config';
import { PrivateKey } from '@hiero-ledger/sdk';
import { parsePayConfig } from '@kosha/pay/pay-config';
import { describe, expect, it } from 'vitest';

const ENV = {
  LLM_PROVIDER: 'anthropic',
  ANTHROPIC_API_KEY: 'sk-ant-test',
  HEDERA_NETWORK: 'testnet',
  CORE_ACCOUNT_ID: '0.0.4000',
  AUDIT_ACCOUNT_ID: '0.0.4900',
  AUDIT_PRIVATE_KEY: PrivateKey.generateED25519().toStringDer(),
  HCS_AUDIT_TOPIC: '0.0.7003',
  SETTLEMENT_TOKEN_ID: '0.0.429274',
  MAX_TX_FEE_HBAR: '2',
  AGENT_RESIDENT_ACCOUNT_ID: '0.0.6001',
  AGENT_RESIDENT_PRIVATE_KEY: PrivateKey.generateED25519().toStringDer(),
  AGENT_RESIDENT_RESERVE_ID: '0.0.6101'
};

describe('readAgentEnv', () => {
  it("needs the chosen provider's key, and names keys without their values", () => {
    const result = readAgentEnv({ ...ENV, ANTHROPIC_API_KEY: '', AUDIT_PRIVATE_KEY: ' ' });

    expect(result).toEqual({
      ok: false,
      data: { keys: expect.arrayContaining(['ANTHROPIC_API_KEY', 'AUDIT_PRIVATE_KEY']) }
    });
    expect(JSON.stringify(result)).not.toContain(ENV.AGENT_RESIDENT_PRIVATE_KEY);
    expect(readAgentEnv({ ...ENV, LLM_PROVIDER: 'openai' })).toMatchObject({
      ok: false,
      data: { keys: ['OPENAI_API_KEY'] }
    });
  });

  it('defaults the budget caps and reads overrides as exact micro-USDC', () => {
    const defaults = readAgentEnv(ENV);
    const custom = readAgentEnv({ ...ENV, DEMO_AGENT_DAILY_USDC: '0.25' });
    if (!defaults.ok || !custom.ok) throw new Error('expected the env to parse');

    expect(budgetCaps(defaults.data)).toEqual({
      perPaymentMicro: 1_000_000n,
      dailyMicro: 5_000_000n
    });
    expect(budgetCaps(custom.data).dailyMicro).toBe(250_000n);
  });
});

describe('payOptions and demoPrompt', () => {
  it('builds options Kosha Pay accepts, and a prompt naming the local demo API', () => {
    const env = readAgentEnv(ENV);
    if (!env.ok) throw new Error('expected the env to parse');

    expect(parsePayConfig(payOptions(env.data))).toMatchObject({
      ok: true,
      data: {
        accountId: '0.0.6001',
        reserveAccountId: '0.0.6101',
        trustedFacilitators: ['0.0.4000']
      }
    });
    expect(demoPrompt(env.data)).toContain('http://localhost:4101/v1/gst-lookup?gstin=<GSTIN>');
    expect(demoPrompt(env.data)).toContain('with kosha_paid_fetch_tool at');
  });
});
