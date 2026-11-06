import {
  KOSHA_PAID_FETCH,
  KoshaBudgetPolicy,
  KoshaPaidFetchTool,
  koshaPayPlugin,
  type PaidFetchOutput
} from './agent-kit-plugin';
import { type KoshaPay } from './kosha-pay';
import { type PreparedPayment } from './prepare-payment';
import {
  AbstractHook,
  type Context,
  type PostSecondaryActionParams
} from '@hashgraph/hedera-agent-kit';
import { Client } from '@hiero-ledger/sdk';
import { transactionIdSchema } from '@kosha/shared/ids';
import {
  type KoshaSplitRequirements,
  koshaSplitRequirementsSchema
} from '@kosha/shared/x402-payment';
import { splitEntry } from '@kosha/shared/x402-payment.fixture';
import { describe, expect, it, vi } from 'vitest';

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
  warnings: []
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// A KoshaPay whose prepare() quotes `totalMicro` and whose complete() settles it
const fakePay = (totalMicro = 101_019n): KoshaPay & { complete: ReturnType<typeof vi.fn> } => {
  const complete = vi.fn<KoshaPay['complete']>(async () => ({
    ok: true,
    data: {
      response: json(BODY),
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
    prepare: async () => ({ ok: true, data: { kind: 'payment', payment: payment(totalMicro) } }),
    complete,
    fetch: async () => json(BODY),
    lastReceipt: null,
    lastError: null
  };
};

// Stands in for HcsAuditTrailHook: records each call it would write to HCS
class RecordingHook extends AbstractHook {
  name = 'recording';
  description = 'records audited calls';
  relevantTools = [KOSHA_PAID_FETCH];
  seen: PaidFetchOutput[] = [];

  override async postToolExecutionHook(params: PostSecondaryActionParams, method: string) {
    if (this.appliesToMethod(method)) this.seen.push(params.toolResult as PaidFetchOutput);
  }
}

const client = Client.forTestnet();
const run = (pay: KoshaPay, hooks: AbstractHook[] = []) =>
  new KoshaPaidFetchTool(pay).execute(client, { hooks } satisfies Context, { url: URL_PAID });

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

  it('returns a free resource without paying', async () => {
    const pay = fakePay();
    pay.prepare = async () => ({ ok: true, data: { kind: 'free', response: json(BODY) } });

    const output = await run(pay);

    expect(output.raw).toMatchObject({ status: 'SUCCESS', paid: false, body: BODY });
    expect(pay.complete).not.toHaveBeenCalled();
  });

  it("reports Kosha Pay's own refusal without paying", async () => {
    const pay = fakePay();
    pay.prepare = async () => ({
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
    expect(second.raw).toMatchObject({ status: 'ERROR', aborted: true });
    expect(second.raw.error).toContain('blocked by policy: Kosha budget');
    expect(pay.complete).toHaveBeenCalledOnce();
    expect(audit.seen.map((output) => output.raw.status)).toEqual(['SUCCESS', 'ERROR']);
  });

  it('blocks a single payment over the per-payment cap', async () => {
    const pay = fakePay(600_000n);

    const output = await run(pay, [new KoshaBudgetPolicy({ perPaymentMicro: 500_000n })]);

    expect(output.raw.status).toBe('ERROR');
    expect(pay.complete).not.toHaveBeenCalled();
  });
});

describe('koshaPayPlugin', () => {
  it('offers exactly one tool, kosha_paid_fetch', () => {
    const tools = koshaPayPlugin(fakePay()).tools({});

    expect(tools.map((tool) => tool.method)).toEqual([KOSHA_PAID_FETCH]);
  });
});
