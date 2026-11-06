import { type KoshaPay } from './kosha-pay';
import { type PreparedPayment } from './prepare-payment';
import { createMemorySpendStore, type SpendStore } from './spend-store';
import {
  AbstractPolicy,
  BaseTool,
  type Context,
  type Plugin,
  type PostCoreActionParams,
  TOOL_STATUS
} from '@hashgraph/hedera-agent-kit';
import { type Client } from '@hiero-ledger/sdk';
import { formatUsdc } from '@kosha/shared/money';
import { z } from 'zod';

// The LangChain tool name; hooks and policies list it in relevantTools
export const KOSHA_PAID_FETCH = 'kosha_paid_fetch';
// The LLM reads the body; a long one would crowd out its context
const MAX_BODY_CHARS = 4_000;

const paramsSchema = z.object({ url: z.url() });
type Params = z.output<typeof paramsSchema>;

// What the LLM (and the kit's HcsAuditTrailHook, through raw.status and raw.transactionId) sees.
// Strings only: the kit runs JSON.stringify over it, which throws on bigint.
export type PaidFetchOutput = {
  raw: {
    status: string;
    url: string;
    paid: boolean;
    httpStatus?: number;
    body?: unknown;
    transactionId?: string;
    totalUsdc?: string;
    tdsUsdc?: string;
    hashscanUrl?: string;
    error?: string;
    // Set when a policy or hook stopped the call, so the tool runs the audit hooks for it
    aborted?: boolean;
  };
  humanMessage: string;
};

// coreAction's result: a signed payment awaiting the policies, or an answer with nothing to pay
type CoreResult = { payment: PreparedPayment } | PaidFetchOutput;

const isQuoted = (result: unknown): result is { payment: PreparedPayment } =>
  typeof result === 'object' && result !== null && 'payment' in result;

const readBody = async (response: Response): Promise<unknown> => {
  const text = (await response.text()).slice(0, MAX_BODY_CHARS);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

// Fetches a Kosha-protected URL and pays its 402 through Kosha Pay. A BaseTool, so the kit runs
// policies between the two steps: coreAction checks and signs the quote without sending it, and
// secondaryAction sends the payment only if every policy let it through.
export class KoshaPaidFetchTool extends BaseTool<Params, Params> {
  method = KOSHA_PAID_FETCH;
  name = 'Kosha paid fetch';
  description =
    'Fetch a paid API that answers HTTP 402. Pays in USDC on Hedera through Kosha, with any Indian ' +
    'TDS reserved in your own reserve on top of the price. Returns the response body and a receipt.';
  parameters = paramsSchema;

  constructor(private readonly pay: KoshaPay) {
    super();
  }

  async normalizeParams(params: Params): Promise<Params> {
    return paramsSchema.parse(params);
  }

  async coreAction({ url }: Params): Promise<CoreResult> {
    const prepared = await this.pay.prepare(url);
    if (!prepared.ok) {
      const { reason, message } = prepared.data;
      return {
        raw: { status: TOOL_STATUS.ERROR, url, paid: false, error: `${reason}: ${message}` },
        humanMessage: `Kosha Pay did not pay for ${url}: ${message}`
      };
    }
    if (prepared.data.kind === 'payment') return { payment: prepared.data.payment };
    const { response } = prepared.data;
    return {
      raw: {
        status: TOOL_STATUS.SUCCESS,
        url,
        paid: false,
        httpStatus: response.status,
        body: await readBody(response)
      },
      humanMessage: `${url} answered ${response.status} without asking for payment.`
    };
  }

  override async shouldSecondaryAction(coreActionResult: CoreResult): Promise<boolean> {
    return isQuoted(coreActionResult);
  }

  override async secondaryAction(quoted: { payment: PreparedPayment }): Promise<PaidFetchOutput> {
    const { url } = quoted.payment;
    const completed = await this.pay.complete(quoted.payment);
    if (!completed.ok) {
      return {
        raw: { status: TOOL_STATUS.ERROR, url, paid: false, error: completed.data.message },
        humanMessage: `Payment for ${url} was refused: ${completed.data.message}`
      };
    }
    const { response, receipt } = completed.data;
    const totalUsdc = formatUsdc(quoted.payment.totalMicro);
    const tdsUsdc = formatUsdc(receipt?.tdsMicroUsdc ?? 0n);
    return {
      raw: {
        status: TOOL_STATUS.SUCCESS,
        url,
        paid: true,
        httpStatus: response.status,
        body: await readBody(response),
        transactionId: receipt?.txId,
        totalUsdc,
        tdsUsdc,
        hashscanUrl: receipt?.hashscanUrl ?? undefined
      },
      humanMessage: `Paid ${totalUsdc} USDC for ${url} (TDS reserved: ${tdsUsdc} USDC).`
    };
  }

  override async handleError(error: unknown, context: Context): Promise<PaidFetchOutput> {
    const output = (await super.handleError(error, context)) as PaidFetchOutput;
    return { ...output, raw: { ...output.raw, aborted: true } };
  }

  // The kit runs postToolExecution hooks only when nothing threw, so a payment a policy blocked
  // would never reach the audit trail. That refusal is the event most worth auditing.
  override async execute(
    client: Client,
    context: Context,
    params: Params
  ): Promise<PaidFetchOutput> {
    const result = (await super.execute(client, context, params)) as PaidFetchOutput;
    if (!result.raw.aborted) return result;
    // The kit's error handler doesn't see the params; name the URL so the agent and the audit can
    const output = { ...result, raw: { ...result.raw, url: params.url, paid: false } };
    try {
      await this.postToolExecutionHook({
        context,
        rawParams: params,
        normalisedParams: params,
        coreActionResult: null,
        toolResult: output,
        client,
        toolType: this.toolType
      });
    } catch (error) {
      console.error('[kosha-pay]: a hook failed while auditing a stopped call', error);
    }
    return output;
  }
}

export type BudgetCaps = {
  perPaymentMicro?: bigint;
  dailyMicro?: bigint;
  fyMicro?: bigint;
};

// The owner's budget, enforced by the kit between quote and payment. Caps count the all-in total
// (price plus TDS). A quote that fits is counted as spent at once, so two calls running together
// can't both squeeze under a cap; a payment that then fails still counts, which errs on the safe
// side.
export class KoshaBudgetPolicy extends AbstractPolicy {
  name = 'Kosha budget';
  description = 'Per-payment, daily and financial-year caps on the all-in total, tax included';
  relevantTools = [KOSHA_PAID_FETCH];

  constructor(
    private readonly caps: BudgetCaps,
    private readonly store: SpendStore = createMemorySpendStore(),
    private readonly now: () => Date = () => new Date()
  ) {
    super();
  }

  protected override async shouldBlockPostCoreAction(
    params: PostCoreActionParams
  ): Promise<boolean> {
    const result: unknown = params.coreActionResult;
    if (!isQuoted(result)) return false;
    const { totalMicro } = result.payment;
    const at = this.now();
    const spent = await this.store.totals(at);
    const { perPaymentMicro, dailyMicro, fyMicro } = this.caps;
    const blocked =
      (perPaymentMicro !== undefined && totalMicro > perPaymentMicro) ||
      (dailyMicro !== undefined && spent.dayMicro + totalMicro > dailyMicro) ||
      (fyMicro !== undefined && spent.fyMicro + totalMicro > fyMicro);
    if (!blocked) await this.store.record(at, totalMicro);
    return blocked;
  }
}

export const koshaPayPlugin = (pay: KoshaPay): Plugin => ({
  name: 'kosha-pay',
  version: '0.1.0',
  description: 'Pays x402 APIs in USDC on Hedera through Kosha, with Indian TDS handled',
  tools: () => [new KoshaPaidFetchTool(pay)]
});
