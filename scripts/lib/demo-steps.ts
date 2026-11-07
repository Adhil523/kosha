import { type CoreResult, currentMonth, currentQuarter, type DemoCore } from './demo-core';
import { sameTransaction, type Sent } from './demo-outside';
import { type PrivateKey } from '@hiero-ledger/sdk';
import { issueCredential } from '@kosha/hedera/credentials';
import { type KoshaPay } from '@kosha/pay/kosha-pay';
import { type Receipt } from '@kosha/pay/pay-receipt';
import { type PreparedPayment } from '@kosha/pay/prepare-payment';
import { type OutsidePaymentRow } from '@kosha/shared/console-api';
import { decodeHeader, HEADERS, SCHEMES } from '@kosha/shared/headers';
import { type AgentIdentity } from '@kosha/shared/ids';
import { amountSchema, formatInr, formatUsdc } from '@kosha/shared/money';
import { type Policy } from '@kosha/shared/registry';
import { type ReleaseRow, tdsExportRowSchema } from '@kosha/shared/tax-reports';
import { paymentRequiredSchema, type QuoteTax, type TaxReason } from '@kosha/shared/x402-payment';

// The spec's eight demo steps (B17), each asserting what the stage shows. A step whose feature
// is not merged, or was cut, is skipped and says so, never failed.

export type StepStatus = 'passed' | 'failed' | 'skipped';
export type StepOutcome = { status: StepStatus; detail: string };
export type DemoAgent = 'resident' | 'unknown' | 'nonresident';

export type DemoContext = {
  core: DemoCore;
  // A Kosha Pay client for one demo agent, allowlisted for both demo APIs
  payFor: (agent: DemoAgent) => KoshaPay;
  identityOf: (agent: DemoAgent) => AgentIdentity;
  coreUrl: string;
  issuerKey: PrivateKey;
  urls: { gstLookup: string; company: string; lei: string };
  // The official x402 client paying as the agent: no Kosha code, no X-KOSHA-AGENT
  stockFetchFor: (agent: DemoAgent) => typeof fetch;
  // A plain token transfer from the agent straight to receiver-in's wallet, outside Kosha
  sendOutside: (agent: DemoAgent) => Promise<Sent>;
  // The agent operator's half of a reserve release: a signed ScheduleSign, base64
  signRelease: (agent: DemoAgent, scheduleId: string) => Promise<string>;
  now: () => Date;
  pause: (ms: number) => Promise<void>;
};

export type DemoStep = {
  label: string;
  title: string;
  run: (context: DemoContext) => Promise<StepOutcome>;
};

const PERCENT_PER_BPS = 100;
const PAN_RATE_BPS = 2000;
const NOT_FOUND = 404;
// The watcher runs every 30 s and the Mirror Node lags a few seconds behind consensus
const OUTSIDE_WAIT_MS = 90_000;
const OUTSIDE_POLL_MS = 5_000;
const MS_PER_SECOND = 1_000;
const GIFT_NOTE = 'Demo: a gift from a relative, not a payment for the API';
// Core schedules a release on the next read; Hedera runs it a few seconds after the co-sign
const RELEASE_POLL_MS = 3_000;
const RELEASE_ATTEMPTS = 10;

const passed = (detail: string): StepOutcome => ({ status: 'passed', detail });
const failed = (detail: string): StepOutcome => ({ status: 'failed', detail });
const skipped = (detail: string): StepOutcome => ({ status: 'skipped', detail });

const describeTax = (tax: QuoteTax): string => `${tax.reason} at ${tax.rateBps / PERCENT_PER_BPS}%`;

type Quote = { payment: PreparedPayment; tax: QuoteTax };

// Pay's first step: the 402, checked and signed, with the tax Core quoted
const quote = async (pay: KoshaPay, url: string): Promise<CoreResult<Quote>> => {
  const prepared = await pay.prepare(url);
  if (!prepared.ok) {
    const body = await prepared.data.response.text().catch(() => '');
    return { ok: false, data: `${prepared.data.reason}: ${prepared.data.message} ${body}`.trim() };
  }
  if (prepared.data.kind === 'free') {
    // Gate relays a policy refusal from Core as a 403 with Core's body (#44)
    const { status } = prepared.data.response;
    const body = await prepared.data.response.text().catch(() => '');
    return { ok: false, data: `${url} was not priced (${status}) ${body}`.trim() };
  }
  const { payment } = prepared.data;
  return { ok: true, data: { payment, tax: payment.quote.extra.kosha.tax } };
};

// Pay's second step: the payment sent, the receipt read back
const settle = async (pay: KoshaPay, payment: PreparedPayment): Promise<CoreResult<Receipt>> => {
  const done = await pay.complete(payment);
  if (!done.ok) return { ok: false, data: `${done.data.reason}: ${done.data.message}` };
  if (!done.data.receipt) return { ok: false, data: 'the API answered without a PAYMENT-RESPONSE' };
  return { ok: true, data: done.data.receipt };
};

type Paid = { tax: QuoteTax; receipt: Receipt };

const payUrl = async (pay: KoshaPay, url: string): Promise<CoreResult<Paid>> => {
  const quoted = await quote(pay, url);
  if (!quoted.ok) return quoted;
  const receipt = await settle(pay, quoted.data.payment);
  if (!receipt.ok) return receipt;
  return { ok: true, data: { tax: quoted.data.tax, receipt: receipt.data } };
};

const expectTax = (tax: QuoteTax, rateBps: number, reasons: TaxReason[]): string | null =>
  tax.rateBps === rateBps && reasons.includes(tax.reason)
    ? null
    : `expected ${reasons.join(' or ')} at ${rateBps / PERCENT_PER_BPS}%, got ${describeTax(tax)}`;

const pairIds = async (
  context: DemoContext,
  agent: DemoAgent
): Promise<CoreResult<{ agentId: string; receiverId: string }>> => {
  const agentId = await context.core.agentIdByIdentity(context.identityOf(agent));
  if (!agentId.ok) return agentId;
  const receiverId = await context.core.receiverIdForAgent(agentId.data);
  if (!receiverId.ok) return receiverId;
  return { ok: true, data: { agentId: agentId.data, receiverId: receiverId.data } };
};

// receiver-in deducts from the first rupee (Kosha's default since #73), so every payment from an
// Indian payer is taxed: 1% with a verified PAN, 20% without one

// 1. agent-resident (Level 1) pays once: 1% reserved on the very first call, as a second leg
const stepFirstRupee: DemoStep = {
  label: '1',
  title: 'agent-resident pays demo-api-in: 1% TDS from the first rupee',
  run: async (context) => {
    const paid = await payUrl(context.payFor('resident'), context.urls.gstLookup);
    if (!paid.ok) return failed(paid.data);
    const wrong = expectTax(paid.data.tax, PERCENT_PER_BPS, ['first_rupee']);
    if (wrong) return failed(wrong);
    if (paid.data.receipt.tdsMicroUsdc <= 0n) return failed('the receipt reserved no TDS');
    return passed(
      `1% reserved on the first call; split ${paid.data.receipt.hashscanUrl ?? paid.data.receipt.txId}`
    );
  }
};

// 2. Three more calls: each one reserves 1%, and the counter reads "first rupee" with no threshold
const stepEveryCall: DemoStep = {
  label: '2',
  title: 'three more calls each reserve 1% TDS, with no threshold to cross',
  run: async (context) => {
    const pay = context.payFor('resident');
    const seen: string[] = [];
    for (let call = 0; call < 3; call += 1) {
      const paid = await payUrl(pay, context.urls.gstLookup);
      if (!paid.ok) return failed(`call ${call + 1}: ${paid.data}`);
      const wrong = expectTax(paid.data.tax, PERCENT_PER_BPS, ['first_rupee']);
      if (wrong) return failed(`call ${call + 1}: ${wrong}`);
      if (paid.data.receipt.tdsMicroUsdc <= 0n) return failed(`call ${call + 1} reserved no TDS`);
      seen.push(describeTax(paid.data.tax));
    }
    const ids = await pairIds(context, 'resident');
    if (!ids.ok) return failed(ids.data);
    const aggregate = await context.core.aggregate(ids.data.receiverId, ids.data.agentId);
    if (!aggregate.ok) return failed(aggregate.data);
    if (aggregate.data.thresholdPaise !== '0') {
      return failed(
        `the counter still shows a threshold of ${aggregate.data.thresholdPaise} paise`
      );
    }
    return passed(`${seen.join(' → ')}; counter in first-rupee mode`);
  }
};

// 3. agent-unknown (Level 0): 20% from the first rupee, then verified with a PAN, then 1%
const stepUnverifiedPayer: DemoStep = {
  label: '3',
  title: 'agent-unknown pays 20% from the first rupee, then presents a PAN credential',
  run: async (context) => {
    const pay = context.payFor('unknown');
    const first = await payUrl(pay, context.urls.gstLookup);
    if (!first.ok) return failed(`unverified: ${first.data}`);
    const wrongFirst = expectTax(first.data.tax, PAN_RATE_BPS, ['first_rupee']);
    if (wrongFirst) return failed(wrongFirst);

    const identity = context.identityOf('unknown');
    const credential = issueCredential(context.issuerKey, identity, {
      residency: 'resident',
      panOnFile: true,
      level: 1
    });
    // Pay's register(): a signed challenge to POST /v1/agents/self, no admin token (B23)
    const registered = await pay.register({ coreUrl: context.coreUrl, credential });
    if (!registered.ok) {
      return failed(
        `presenting the credential: ${registered.data.reason} ${registered.data.message}`
      );
    }

    const next = await quote(pay, context.urls.gstLookup);
    if (!next.ok) return failed(`the quote after the credential: ${next.data}`);
    const wrongNext = expectTax(next.data.tax, PERCENT_PER_BPS, ['first_rupee']);
    if (wrongNext) return failed(`the quote after the credential: ${wrongNext}`);
    return passed(`${describeTax(first.data.tax)} → verified: ${describeTax(next.data.tax)}`);
  }
};

// 4. agent-nonresident pays the foreign API: no TDS, flagged for FEMA review
const stepNonResident: DemoStep = {
  label: '4',
  title: 'agent-nonresident pays demo-api-global: no TDS, FEMA review flag',
  run: async (context) => {
    const paid = await payUrl(context.payFor('nonresident'), context.urls.lei);
    if (!paid.ok) return failed(paid.data);
    const wrong = expectTax(paid.data.tax, 0, ['receiver_non_resident', 'non_resident']);
    if (wrong) return failed(wrong);
    if (!paid.data.tax.flags.includes('fema_review')) return failed('no fema_review flag');
    return passed(`${describeTax(paid.data.tax)}, flagged fema_review, ${paid.data.receipt.txId}`);
  }
};

const CAP_POLICY: Policy = {
  perPaymentMicro: amountSchema.parse('1000000'),
  dailyMicro: amountSchema.parse('1'),
  fyBudgetMicro: amountSchema.parse('500000000'),
  allowlist: [],
  thresholdAction: 'warn',
  acceptRulepacks: ['in-2026.2']
};
const OPEN_POLICY: Policy = { ...CAP_POLICY, dailyMicro: amountSchema.parse('10000000') };

// 5. agent-resident hits its daily cap: Core refuses the quote (A12). The Agent Kit budget policy
// does the same in-process in `pnpm --filter @kosha/demo-agent start` (B13), which needs an LLM key.
const stepDailyCap: DemoStep = {
  label: '5',
  title: 'agent-resident hits its daily cap and the policy blocks the call',
  run: async (context) => {
    const agentId = await context.core.agentIdByIdentity(context.identityOf('resident'));
    if (!agentId.ok) return failed(agentId.data);
    const previous = await context.core.getPolicy(agentId.data);
    if (!previous.ok) return failed(previous.data);
    const capped = await context.core.putPolicy(agentId.data, CAP_POLICY);
    if (!capped.ok) return failed(capped.data);
    try {
      const quoted = await quote(context.payFor('resident'), context.urls.gstLookup);
      if (quoted.ok) return failed('the quote went through under a ₹0.00001 daily cap');
      if (!quoted.data.includes('policy_daily'))
        return failed(`refused, but not by the cap: ${quoted.data}`);
      return passed(
        'Core refused the quote with policy_daily; the Agent Kit policy does the same in demo-agent'
      );
    } finally {
      await context.core.putPolicy(agentId.data, previous.data ?? OPEN_POLICY);
    }
  }
};

// 6. A stock x402 client pays through compatibility mode (A23)
const stepCompat: DemoStep = {
  label: '6',
  title: 'a stock @x402/fetch client pays through compatibility mode',
  run: async (context) => {
    const unpaid = await fetch(context.urls.gstLookup);
    const header = unpaid.headers.get(HEADERS.paymentRequired);
    const required = header ? decodeHeader(paymentRequiredSchema, header) : null;
    const offersExact = required?.ok
      ? required.data.accepts.some((entry) => entry.scheme === SCHEMES.exact)
      : false;
    if (!offersExact) {
      return skipped('(cut) A23 compatibility mode is not merged: the 402 offers no exact entry');
    }
    const response = await context.stockFetchFor('unknown')(context.urls.gstLookup);
    const settlement = response.headers.get(HEADERS.paymentResponse);
    if (!response.ok || !settlement) {
      return failed(`the stock client got ${response.status}: ${await response.text()}`);
    }
    return passed(
      `${response.status} with a PAYMENT-RESPONSE, X-KOSHA-TAX ${response.headers.get('X-KOSHA-TAX') ?? '(none)'}`
    );
  }
};

// Core's row for a transfer, once its watcher has flagged it; null if it never does in time
const waitForFlag = async (
  context: DemoContext,
  receiverId: string,
  transactionId: string
): Promise<CoreResult<OutsidePaymentRow | null>> => {
  for (let waited = 0; waited <= OUTSIDE_WAIT_MS; waited += OUTSIDE_POLL_MS) {
    const rows = await context.core.outsidePayments(receiverId);
    if (!rows.ok) return rows;
    const row = rows.data.find((flagged) => sameTransaction(flagged.transactionId, transactionId));
    if (row) return { ok: true, data: row };
    await context.pause(OUTSIDE_POLL_MS);
  }
  return { ok: true, data: null };
};

// 7. agent-resident pays receiver-in directly: Core flags it, the owner marks it a gift (A19, B24)
const stepOutsidePayment: DemoStep = {
  label: '7',
  title: 'an outside transfer is flagged and marked as a gift',
  run: async (context) => {
    const status = await context.core.probe('/v1/outside-payments?receiverId=none');
    if (status === NOT_FOUND)
      return skipped('(cut) the outside-payment watcher (A19) is not built');
    const ids = await pairIds(context, 'resident');
    if (!ids.ok) return failed(ids.data);

    const started = context.now().getTime();
    const sent = await context.sendOutside('resident');
    if (!sent.ok) return failed(sent.data);
    const flagged = await waitForFlag(context, ids.data.receiverId, sent.data);
    if (!flagged.ok) return failed(flagged.data);
    if (!flagged.data) {
      return failed(
        `Core did not flag ${sent.data} within ${OUTSIDE_WAIT_MS / MS_PER_SECOND} s; is its watcher running?`
      );
    }
    const seconds = Math.round((context.now().getTime() - started) / MS_PER_SECOND);

    const gift = await context.core.classifyOutside(flagged.data.id, {
      classification: 'not_consideration_gift',
      note: GIFT_NOTE
    });
    if (!gift.ok) return failed(`marking it a gift: ${gift.data}`);
    return passed(
      `${sent.data} flagged in ${seconds} s with ${gift.data.shortfallPaise} paise TDS short, then marked a gift`
    );
  }
};

// 8. The TDS file; then the challan and the reserve release (A20, B25: cut 2)
const stepTdsFile: DemoStep = {
  label: '8',
  title: 'download the TDS file for the quarter',
  run: async (context) => {
    const ids = await pairIds(context, 'resident');
    if (!ids.ok) return failed(ids.data);
    const quarter = currentQuarter(context.now());
    const csv = await context.core.tdsExport(ids.data.receiverId, quarter);
    if (!csv.ok) return failed(csv.data);
    const [header = '', ...rows] = csv.data.split(/\r?\n/).filter((line) => line.length > 0);
    const expected = Object.keys(tdsExportRowSchema.shape).join(',');
    if (header !== expected) return failed(`the header row is "${header}"`);
    return passed(`${rows.length} rows for ${quarter}, header as the statement needs it`);
  }
};

// agent's release under a challan, once `done` holds for it; null if it never does in time
const waitForRelease = async (
  context: DemoContext,
  challanId: string,
  agentId: string,
  done: (release: ReleaseRow) => boolean
): Promise<CoreResult<ReleaseRow | null>> => {
  for (let attempt = 0; attempt < RELEASE_ATTEMPTS; attempt += 1) {
    const rows = await context.core.releases(challanId);
    if (!rows.ok) return rows;
    const release = rows.data.find((row) => row.agentId === agentId);
    if (release && done(release)) return { ok: true, data: release };
    await context.pause(RELEASE_POLL_MS);
  }
  return { ok: true, data: null };
};

// 8b. The month's challan (a mock reference), then agent-resident co-signs its release (A20, B25)
const stepChallan: DemoStep = {
  label: '8b',
  title: 'record a mock challan and co-sign the reserve release',
  run: async (context) => {
    const status = await context.core.probe('/v1/challans');
    if (status === NOT_FOUND) return skipped('(cut) the monthly close (A20) is not built');
    const ids = await pairIds(context, 'resident');
    if (!ids.ok) return failed(ids.data);
    const { agentId, receiverId } = ids.data;
    const month = currentMonth(context.now());

    const close = await context.core.monthlyClose(receiverId, month);
    if (!close.ok) return failed(close.data);
    if (!close.data.rows.some((row) => row.agentId === agentId)) {
      return failed(`agent-resident has no TDS to release in ${month}`);
    }
    const challan = await context.core.closeMonth(receiverId, month, `DEMO-MOCK-${month}`);
    if (!challan.ok) return failed(challan.data);

    const ready = await waitForRelease(
      context,
      challan.data.id,
      agentId,
      (row) => row.status !== 'pending'
    );
    if (!ready.ok) return failed(ready.data);
    if (!ready.data) return failed('Core did not schedule agent-resident’s release');
    const release = ready.data;
    if (release.status === 'executed') {
      return passed(`${month} was closed earlier; release ${release.id} has already run`);
    }
    if (release.status !== 'scheduled' || !release.scheduleId) {
      return failed(`release ${release.id} is ${release.status}, not waiting for a co-sign`);
    }

    const signed = await context.signRelease('resident', release.scheduleId);
    const cosigned = await context.core.cosignRelease(release.id, signed);
    if (!cosigned.ok) return failed(cosigned.data);
    const ran =
      cosigned.data.status === 'executed'
        ? { ok: true as const, data: cosigned.data }
        : await waitForRelease(
            context,
            challan.data.id,
            agentId,
            (row) => row.status === 'executed'
          );
    if (!ran.ok) return failed(ran.data);
    if (!ran.data) return failed(`co-signed, but schedule ${release.scheduleId} has not run`);
    return passed(
      `challan for ${month} (${formatInr(BigInt(close.data.totalTdsPaise))}); ${formatUsdc(BigInt(release.micro))} USDC released from ${release.reserveAccountId}, schedule ${release.scheduleId}`
    );
  }
};

export const DEMO_STEPS: DemoStep[] = [
  stepFirstRupee,
  stepEveryCall,
  stepUnverifiedPayer,
  stepNonResident,
  stepDailyCap,
  stepCompat,
  stepOutsidePayment,
  stepTdsFile,
  stepChallan
];
