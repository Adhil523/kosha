import { type CoreResult, type DemoCore } from './demo-core';
import { DEMO_STEPS, type DemoContext, type StepOutcome } from './demo-steps';
import { PrivateKey } from '@hiero-ledger/sdk';
import { type OutsidePaymentRow } from '@kosha/shared/console-api';
import { LEDGER_PAGE_FIXTURE, OUTSIDE_PAYMENTS_FIXTURE } from '@kosha/shared/fixtures';
import { agentIdentitySchema, transactionIdSchema } from '@kosha/shared/ids';
import { type OutsideClassify } from '@kosha/shared/tax-reports';
import { describe, expect, it } from 'vitest';

const SENT_ID = '0.0.1001@1762425000.1';
const [flaggedFixture] = OUTSIDE_PAYMENTS_FIXTURE;
const [ledgerRow] = LEDGER_PAGE_FIXTURE.rows;
if (!flaggedFixture || !ledgerRow) throw new Error('the fixtures are empty');
const FLAGGED: OutsidePaymentRow = {
  ...flaggedFixture,
  transactionId: transactionIdSchema.parse('0.0.1001@1762425000.000000001')
};

const unused = (): never => {
  throw new Error('not used by this step');
};
const ok = <T>(data: T): CoreResult<T> => ({ ok: true, data });

type Fake = { context: DemoContext; classified: OutsideClassify[] };

// Core answers the probe with `probe` and lists the flagged row from the `flagOnRead`th read on
const fakeContext = ({ probe = 200, flagOnRead = 2 } = {}): Fake => {
  const classified: OutsideClassify[] = [];
  let reads = 0;
  const core: DemoCore = {
    agents: unused,
    agentIdByIdentity: async () => ok('agt_resident'),
    receiverIdForAgent: async () => ok(ledgerRow.receiverId),
    aggregate: unused,
    getPolicy: unused,
    putPolicy: unused,
    tdsExport: unused,
    outsidePayments: async () => {
      reads += 1;
      return ok(reads >= flagOnRead ? [FLAGGED] : []);
    },
    classifyOutside: async (_id, body) => {
      classified.push(body);
      return ok({ ...FLAGGED, ...body, note: body.note ?? null });
    },
    probe: async () => probe
  };
  const context: DemoContext = {
    core,
    payFor: unused,
    identityOf: () => agentIdentitySchema.parse('hedera:testnet:0.0.1001'),
    coreUrl: 'http://localhost:4100',
    issuerKey: PrivateKey.generateED25519(),
    urls: { gstLookup: '', company: '', lei: '' },
    stockFetchFor: unused,
    sendOutside: async () => ({ ok: true, data: SENT_ID }),
    now: () => new Date('2026-11-06T12:00:00Z'),
    pause: async () => undefined
  };
  return { context, classified };
};

const runStep7 = (context: DemoContext): Promise<StepOutcome> => {
  const step = DEMO_STEPS.find((candidate) => candidate.label === '7');
  if (!step) throw new Error('no step 7');
  return step.run(context);
};

describe('demo step 7: an outside transfer', () => {
  it('waits for the watcher to flag the transfer, then marks it a gift with a note', async () => {
    const { context, classified } = fakeContext();
    const outcome = await runStep7(context);
    expect(outcome.status).toBe('passed');
    expect(outcome.detail).toContain(SENT_ID);
    expect(classified).toEqual([
      { classification: 'not_consideration_gift', note: expect.any(String) }
    ]);
  });

  it('fails, naming the watcher, when Core never flags it', async () => {
    const { context, classified } = fakeContext({ flagOnRead: Number.POSITIVE_INFINITY });
    const outcome = await runStep7(context);
    expect(outcome.status).toBe('failed');
    expect(outcome.detail).toContain('watcher');
    expect(classified).toEqual([]);
  });

  it('is skipped when Core has no outside-payment endpoint', async () => {
    const { context } = fakeContext({ probe: 404 });
    expect((await runStep7(context)).status).toBe('skipped');
  });
});
