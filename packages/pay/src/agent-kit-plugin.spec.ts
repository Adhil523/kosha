import {
  KOSHA_PAID_FETCH_TOOL,
  KoshaBudgetPolicy,
  KoshaPaidFetchTool,
  koshaPayPlugin,
  type PaidFetchOutput
} from './agent-kit-plugin';
import { type KoshaPay } from './kosha-pay';
import { type PreparedPayment } from './prepare-payment';
import { createMemorySpendStore } from './spend-store';
import {
  AbstractHook,
  AbstractPolicy,
  AgentMode,
  type Context,
  type PostSecondaryActionParams,
  type PreToolExecutionParams,
  TOOL_TYPE
} from '@hashgraph/hedera-agent-kit';
import { Client } from '@hiero-ledger/sdk';
import { transactionIdSchema } from '@kosha/shared/ids';
import {
  type KoshaSplitRequirements,
  koshaSplitRequirementsSchema
} from '@kosha/shared/x402-payment';
import { splitEntry } from '@kosha/shared/x402-payment.fixture';
import { describe, expect, it, type Mock, vi } from 'vitest';

const NOW = new Date('2026-11-06T10:30:00Z');
const URL_PAID = 'http://localhost:4101/v1/gst-lookup?gstin=29AAKCK4821M1ZQ';
const BODY = { registration: { gstin: '29AAKCK4821M1ZQ' } };
const TX_ID = transactionIdSchema.parse('0.0.4000@1762424400.123456789');
const QUOTE: KoshaSplitRequirements = koshaSplitRequirementsSchema.parse(splitEntry);

const payment = (totalMicro: bigint): PreparedPayment => ({
  url: URL_PAID,
  init: {},
  quote: QUOTE,
  signature: 'signed',
  totalMicro,
  reservedAt: new Date(),
  warnings: []
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// A KoshaPay whose prepare() quotes `totalMicro` and whose complete() settles it
const fakePay = (
  totalMicro = 101_019n,
  paidResponse: () => Response = () => json(BODY)
): KoshaPay & {
  prepare: Mock<KoshaPay['prepare']>;
  complete: Mock<KoshaPay['complete']>;
  release: Mock<KoshaPay['release']>;
} => {
  const complete = vi.fn<KoshaPay['complete']>(async () => ({
    ok: true,
    data: {
      response: paidResponse(),
      receipt: {
        txId: TX_ID,
        payer: null,
        hashscanUrl: 'https://hashscan.io/testnet/transaction/0.0.4000-1762424400-123456789',
        hcsSequence: 6,
        tdsMicroUsdc: 1019n,
        totalMicro
      }
    }
  }));
  return {
    prepare: vi.fn<KoshaPay['prepare']>(async () => ({
      ok: true,
      data: { kind: 'payment', payment: payment(totalMicro) }
    })),
    complete,
    release: vi.fn<KoshaPay['release']>(async () => {}),
    fetch: async () => json(BODY),
    register: () => Promise.reject(new Error('register is not part of this test')),
    lastReceipt: null,
    lastError: null
  };
};

// Stands in for HcsAuditTrailHook: records each call it would write to HCS
class RecordingHook extends AbstractHook {
  name = 'recording';
  description = 'records audited calls';
  relevantTools = [KOSHA_PAID_FETCH_TOOL];
  seen: PaidFetchOutput[] = [];

  override async postToolExecutionHook(params: PostSecondaryActionParams, method: string) {
    if (this.appliesToMethod(method)) this.seen.push(params.toolResult as PaidFetchOutput);
  }
}

// A post-execution hook that fails, as a policy blocking after the fact or a broken logger would
class ThrowingHook extends AbstractHook {
  name = 'throwing';
  description = 'fails after the call';
  relevantTools = [KOSHA_PAID_FETCH_TOOL];
  calls = 0;

  override async postToolExecutionHook() {
    this.calls += 1;
    throw new Error('hook failed');
  }
}

// A body whose stream breaks mid-read, as a dropped connection would
const unreadable = () =>
  new Response(
    new ReadableStream({
      start: (controller) => controller.error(new Error('connection reset'))
    })
  );

const client = Client.forTestnet();
const run = (pay: KoshaPay, hooks: AbstractHook[] = [], mode?: AgentMode) =>
  new KoshaPaidFetchTool(pay).execute(client, { hooks, mode } satisfies Context, {
    url: URL_PAID
  });

// A policy that runs after the budget and blocks every quote
class BlockAfterQuotePolicy extends AbstractPolicy {
  name = 'Block after quote';
  description = 'blocks every quote';
  relevantTools = [KOSHA_PAID_FETCH_TOOL];

  protected override shouldBlockPostCoreAction() {
    return true;
  }
}

// An org-wide rule written against tool types, not names: no transaction tools at all
class NoTransactionsPolicy extends AbstractPolicy {
  name = 'No transactions';
  description = 'read-only agent';
  relevantTools = ['*'];

  protected override shouldBlockPreToolExecution(params: PreToolExecutionParams) {
    return params.toolType === TOOL_TYPE.TRANSACTION;
  }
}

describe('KoshaPaidFetchTool', () => {
  it('pays the 402 and returns the body with a string-only receipt', async () => {
    const pay = fakePay();
    const audit = new RecordingHook();

    const output = await run(pay, [audit]);

    expect(output.raw).toMatchObject({
      status: 'SUCCESS',
      paid: true,
      body: BODY,
      transactionId: TX_ID,
      totalUsdc: '0.101019',
      tdsUsdc: '0.001019'
    });
    expect(() => JSON.stringify(output)).not.toThrow();
    expect(pay.complete).toHaveBeenCalledOnce();
    expect(audit.seen).toHaveLength(1);
  });

  it('reports a settled payment as paid, with its transaction ID, when the body read fails', async () => {
    const pay = fakePay(101_019n, unreadable);
    const audit = new RecordingHook();

    const output = await run(pay, [audit]);

    expect(output.raw).toMatchObject({ status: 'SUCCESS', paid: true, transactionId: TX_ID });
    expect(output.raw.bodyError).toContain('connection reset');
    expect(audit.seen.map((seen) => seen.raw.paid)).toEqual([true]);
  });

  it('keeps a paid call paid when a hook after it throws, and runs every hook once', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pay = fakePay();
    const throwing = new ThrowingHook();
    const audit = new RecordingHook();

    const output = await run(pay, [throwing, audit]);

    expect(output.raw).toMatchObject({ status: 'SUCCESS', paid: true, transactionId: TX_ID });
    expect(throwing.calls).toBe(1);
    expect(audit.seen).toHaveLength(1);
    expect(pay.complete).toHaveBeenCalledOnce();
    quiet.mockRestore();
  });

  it('warns the agent not to pay again when the paid call gets no answer', async () => {
    const pay = fakePay();
    pay.complete.mockRejectedValueOnce(new Error('socket hang up'));
    const audit = new RecordingHook();

    const output = await run(pay, [audit]);

    expect(output.raw).toMatchObject({ status: 'ERROR', paid: false });
    expect(output.raw.error).toContain('may have settled');
    expect(output.humanMessage).toContain('Do not pay again');
    expect(audit.seen).toHaveLength(1);
  });

  it.each([AgentMode.RETURN_BYTES, AgentMode.CUSTOM_EXECUTE_TX, AgentMode.CUSTOM_RETURN_BYTES])(
    'neither fetches nor pays in %s mode',
    async (mode) => {
      const pay = fakePay();

      const output = await run(pay, [], mode);

      expect(output.raw).toMatchObject({ status: 'ERROR', paid: false });
      expect(output.raw.error).toContain(`runs in ${mode}`);
      expect(pay.prepare).not.toHaveBeenCalled();
      expect(pay.complete).not.toHaveBeenCalled();
    }
  );

  it('pays in autonomous mode, set or left to the default', async () => {
    const output = await run(fakePay(), [], AgentMode.AUTONOMOUS);

    expect(output.raw.paid).toBe(true);
  });

  it('is a transaction tool, so a policy on every transaction tool stops it', async () => {
    const pay = fakePay();

    const output = await run(pay, [new NoTransactionsPolicy()]);

    expect(output.raw.error).toContain('blocked by policy: No transactions');
    expect(pay.prepare).not.toHaveBeenCalled();
  });

  it('returns a free resource without paying', async () => {
    const pay = fakePay();
    pay.prepare.mockResolvedValue({ ok: true, data: { kind: 'free', response: json(BODY) } });

    const output = await run(pay);

    expect(output.raw).toMatchObject({ status: 'SUCCESS', paid: false, body: BODY });
    expect(pay.complete).not.toHaveBeenCalled();
  });

  it("reports Kosha Pay's own refusal without paying", async () => {
    const pay = fakePay();
    pay.prepare.mockResolvedValue({
      ok: false,
      data: { reason: 'policy_daily', message: 'daily cap reached', response: json({}, 402) }
    });

    const output = await run(pay);

    expect(output.raw).toMatchObject({ status: 'ERROR', paid: false });
    expect(output.raw.error).toContain('policy_daily');
    expect(pay.complete).not.toHaveBeenCalled();
  });
});

describe('KoshaBudgetPolicy', () => {
  it('blocks a quote over the daily cap before anything is sent, and audits the refusal', async () => {
    const pay = fakePay(101_019n);
    const audit = new RecordingHook();
    const policy = new KoshaBudgetPolicy({ dailyMicro: 150_000n });

    const first = await run(pay, [policy, audit]);
    const second = await run(pay, [policy, audit]);

    expect(first.raw.status).toBe('SUCCESS');
    expect(second.raw).toMatchObject({
      status: 'ERROR',
      aborted: true,
      url: URL_PAID,
      paid: false
    });
    expect(second.raw.error).toContain('blocked by policy: Kosha budget (daily cap');
    expect(second.raw.error).toContain('0.202038 USDC, over 0.15 USDC');
    expect(pay.complete).toHaveBeenCalledOnce();
    // The blocked payment is never sent, so Pay's own caps get it back
    expect(pay.release).toHaveBeenCalledOnce();
    expect(audit.seen.map((output) => output.raw.status)).toEqual(['SUCCESS', 'ERROR']);
  });

  it('blocks a single payment over the per-payment cap', async () => {
    const pay = fakePay(600_000n);

    const output = await run(pay, [new KoshaBudgetPolicy({ perPaymentMicro: 500_000n })]);

    expect(output.raw.error).toContain('per-payment cap: 0.60 USDC is over 0.50 USDC');
    expect(pay.complete).not.toHaveBeenCalled();
  });

  it('lets only one of two concurrent payments through a cap that fits one', async () => {
    const pay = fakePay(101_019n);
    const policy = new KoshaBudgetPolicy({ dailyMicro: 150_000n });

    const outputs = await Promise.all([run(pay, [policy]), run(pay, [policy])]);

    expect(outputs.map((output) => output.raw.paid).sort()).toEqual([false, true]);
    expect(pay.complete).toHaveBeenCalledOnce();
  });

  it('gives the budget back when a later policy blocks the payment', async () => {
    const pay = fakePay(101_019n);
    const store = createMemorySpendStore();
    const budget = new KoshaBudgetPolicy({ dailyMicro: 150_000n }, store, () => NOW);

    const blocked = await run(pay, [budget, new BlockAfterQuotePolicy()]);

    expect(blocked.raw.error).toContain('blocked by policy: Block after quote');
    expect(await store.totals(NOW)).toEqual({ dayMicro: 0n, fyMicro: 0n });
  });

  it('gives the budget back when the server refuses the payment', async () => {
    const pay = fakePay(101_019n);
    pay.complete.mockResolvedValueOnce({
      ok: false,
      data: { reason: 'payment_rejected', message: 'replay', response: json({}, 402) }
    });
    const store = createMemorySpendStore();
    const budget = new KoshaBudgetPolicy({ dailyMicro: 150_000n }, store, () => NOW);

    const refused = await run(pay, [budget]);

    expect(refused.raw).toMatchObject({ status: 'ERROR', paid: false });
    expect(await store.totals(NOW)).toEqual({ dayMicro: 0n, fyMicro: 0n });
  });
});

describe('koshaPayPlugin', () => {
  it('offers exactly one tool, named like the kit tools, with its parameter described', () => {
    const tools = koshaPayPlugin(fakePay()).tools({});

    expect(tools.map((tool) => tool.method)).toEqual(['kosha_paid_fetch_tool']);
    expect(tools[0]?.description).toContain('Parameters:\n- url (string, required)');
    expect(tools[0]?.parameters.shape.url.description).toContain('paid API');
  });

  it('parses its own output back, and anything else as a PARSE_ERROR', () => {
    const [tool] = koshaPayPlugin(fakePay()).tools({});
    const output: PaidFetchOutput = {
      raw: { status: 'SUCCESS', url: URL_PAID, paid: true, transactionId: TX_ID },
      humanMessage: 'Paid'
    };

    expect(tool?.outputParser?.(JSON.stringify(output))).toEqual(output);
    expect(tool?.outputParser?.('not json').raw.status).toBe('PARSE_ERROR');
    expect(tool?.outputParser?.('{"raw":{}}').raw.status).toBe('PARSE_ERROR');
  });
});
