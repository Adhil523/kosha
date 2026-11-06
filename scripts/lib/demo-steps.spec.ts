import { type CoreResult, type DemoCore } from './demo-core';
import { DEMO_STEPS, type DemoContext, type StepOutcome } from './demo-steps';
import { PrivateKey } from '@hiero-ledger/sdk';
import { type OutsidePaymentRow } from '@kosha/shared/console-api';
import {
  CHALLANS_FIXTURE,
  LEDGER_PAGE_FIXTURE,
  MONTHLY_CLOSE_FIXTURE,
  OUTSIDE_PAYMENTS_FIXTURE,
  RELEASES_FIXTURE
} from '@kosha/shared/fixtures';
import { agentIdentitySchema, transactionIdSchema } from '@kosha/shared/ids';
import { type OutsideClassify, type ReleaseRow } from '@kosha/shared/tax-reports';
import { describe, expect, it } from 'vitest';

const SENT_ID = '0.0.1001@1762425000.1';
const [flaggedFixture] = OUTSIDE_PAYMENTS_FIXTURE;
const [ledgerRow] = LEDGER_PAGE_FIXTURE.rows;
const [challan] = CHALLANS_FIXTURE;
const [releaseFixture] = RELEASES_FIXTURE;
if (!flaggedFixture || !ledgerRow || !challan || !releaseFixture) {
  throw new Error('the fixtures are empty');
}
const FLAGGED: OutsidePaymentRow = {
  ...flaggedFixture,
  transactionId: transactionIdSchema.parse('0.0.1001@1762425000.000000001')
};
// agent-resident's release, waiting for the co-sign
const SCHEDULED: ReleaseRow = { ...releaseFixture, status: 'scheduled', cosignedBy: null };
const RESIDENT = releaseFixture.agentId;

const unused = (): never => {
  throw new Error('not used by this step');
};
const ok = <T>(data: T): CoreResult<T> => ({ ok: true, data });

type FakeOptions = { probe?: number; flagOnRead?: number; release?: ReleaseRow };
type Fake = { context: DemoContext; classified: OutsideClassify[]; cosigned: string[] };

// Core answers the probe with `probe`, lists the flagged row from the `flagOnRead`th read on, and
// holds one release for agent-resident that runs when it is co-signed
const fakeContext = ({
  probe = 200,
  flagOnRead = 2,
  release = SCHEDULED
}: FakeOptions = {}): Fake => {
  const classified: OutsideClassify[] = [];
  const cosigned: string[] = [];
  let reads = 0;
  let current = release;
  const core: DemoCore = {
    agents: unused,
    agentIdByIdentity: async () => ok(RESIDENT),
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
    monthlyClose: async () => ok(MONTHLY_CLOSE_FIXTURE),
    closeMonth: async () => ok(challan),
    releases: async () => ok([current]),
    cosignRelease: async (id, transaction) => {
      cosigned.push(transaction);
      current = { ...current, status: 'executed', cosignedBy: 'agent operator' };
      return ok({ ...current, id });
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
    signRelease: async (_agent, scheduleId) => `signed:${scheduleId}`,
    now: () => new Date('2026-11-06T12:00:00Z'),
    pause: async () => undefined
  };
  return { context, classified, cosigned };
};

const runStep = (label: string, context: DemoContext): Promise<StepOutcome> => {
  const step = DEMO_STEPS.find((candidate) => candidate.label === label);
  if (!step) throw new Error(`no step ${label}`);
  return step.run(context);
};

describe('demo step 7: an outside transfer', () => {
  it('waits for the watcher to flag the transfer, then marks it a gift with a note', async () => {
    const { context, classified } = fakeContext();
    const outcome = await runStep('7', context);
    expect(outcome.status).toBe('passed');
    expect(outcome.detail).toContain(SENT_ID);
    expect(classified).toEqual([
      { classification: 'not_consideration_gift', note: expect.any(String) }
    ]);
  });

  it('fails, naming the watcher, when Core never flags it', async () => {
    const { context, classified } = fakeContext({ flagOnRead: Number.POSITIVE_INFINITY });
    const outcome = await runStep('7', context);
    expect(outcome.status).toBe('failed');
    expect(outcome.detail).toContain('watcher');
    expect(classified).toEqual([]);
  });

  it('is skipped when Core has no outside-payment endpoint', async () => {
    const { context } = fakeContext({ probe: 404 });
    expect((await runStep('7', context)).status).toBe('skipped');
  });
});

describe('demo step 8b: the challan and the reserve release', () => {
  it('co-signs agent-resident’s scheduled release with its own key, and sees it run', async () => {
    const { context, cosigned } = fakeContext();
    const outcome = await runStep('8b', context);
    expect(outcome.status).toBe('passed');
    expect(cosigned).toEqual([`signed:${SCHEDULED.scheduleId}`]);
  });

  it('passes without signing again when the month was closed and released earlier', async () => {
    const { context, cosigned } = fakeContext({ release: releaseFixture });
    const outcome = await runStep('8b', context);
    expect(outcome.status).toBe('passed');
    expect(outcome.detail).toContain('already run');
    expect(cosigned).toEqual([]);
  });

  it('fails when Core never schedules the release', async () => {
    const pending: ReleaseRow = { ...SCHEDULED, status: 'pending', scheduleId: null };
    const { context, cosigned } = fakeContext({ release: pending });
    expect((await runStep('8b', context)).status).toBe('failed');
    expect(cosigned).toEqual([]);
  });

  it('is skipped when Core has no monthly close', async () => {
    const { context } = fakeContext({ probe: 404 });
    expect((await runStep('8b', context)).status).toBe('skipped');
  });
});
