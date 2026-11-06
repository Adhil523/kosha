import 'server-only';
import {
  consoleReceiverId,
  coreBase,
  type CoreResult,
  getParsed,
  isMockMode,
  notConfigured,
  sendParsed
} from '@/lib/core.server';
import { URLS } from '@/lib/urls';
import { CHALLANS_FIXTURE, MONTHLY_CLOSE_FIXTURE, RELEASES_FIXTURE } from '@kosha/shared/fixtures';
import { scheduleIdSchema } from '@kosha/shared/ids';
import {
  type ChallanRow,
  challanRowSchema,
  type MonthlyClose,
  monthlyCloseSchema,
  type ReleaseRow,
  releaseRowSchema
} from '@kosha/shared/tax-reports';
import { z } from 'zod';

// The monthly close (A20) as the Console reads and acts on it: the month's TDS per payer, the
// challan the owner records, and one release per payer reserve that the agent operator co-signs.

const CONFLICT = 409;
const NOT_FOUND = 404;
const MOCK_SCHEDULE_BASE = 8100;
export const DEMO_SIGNER = 'agent operator (demo signer)';

export type ChallanRecorded = { challan: ChallanRow; releases: ReleaseRow[] };
const challanRecordedSchema = z.object({
  challan: challanRowSchema,
  releases: z.array(releaseRowSchema)
});

// Mock mode keeps recorded challans and co-signed releases in memory, so the screens round-trip
const mock = { challans: [...CHALLANS_FIXTURE], releases: [...RELEASES_FIXTURE] };

const ok = <T>(data: T): CoreResult<T> => ({ ok: true, status: 200, data });
const refuse = (status: number, message: string) =>
  ({ ok: false, status, data: { message } }) as const;

export const getMonthlyClose = async (month: string): Promise<CoreResult<MonthlyClose>> => {
  if (isMockMode()) return ok({ ...MONTHLY_CLOSE_FIXTURE, month });
  const base = coreBase();
  if (!base) return notConfigured;
  return getParsed(URLS.core.close(base, consoleReceiverId(), month), monthlyCloseSchema);
};

export const getChallans = async (): Promise<CoreResult<ChallanRow[]>> => {
  if (isMockMode()) return ok(mock.challans);
  const base = coreBase();
  if (!base) return notConfigured;
  const query = { receiverId: consoleReceiverId() };
  return getParsed(URLS.core.challans(base, query), z.array(challanRowSchema));
};

const mockRecord = (month: string): CoreResult<ChallanRecorded> => {
  if (mock.challans.some((row) => row.month === month)) {
    return refuse(CONFLICT, `${month} is already closed`);
  }
  const close = { ...MONTHLY_CLOSE_FIXTURE, month };
  const challan = challanRowSchema.parse({
    id: `chl_${mock.challans.length + 1}`,
    receiverId: close.receiverId,
    month,
    tdsPaise: close.totalTdsPaise,
    recordedAt: new Date().toISOString(),
    hcsSequence: null
  });
  const releases = close.rows.map((row, index) =>
    releaseRowSchema.parse({
      id: `rel_${mock.releases.length + index + 1}`,
      challanId: challan.id,
      agentId: row.agentId,
      reserveAccountId: row.reserveAccountId,
      micro: row.tdsMicro,
      scheduleId: scheduleIdSchema.parse(
        `0.0.${MOCK_SCHEDULE_BASE + mock.releases.length + index}`
      ),
      status: 'scheduled',
      cosignedBy: null
    })
  );
  mock.challans.push(challan);
  mock.releases.push(...releases);
  return { ok: true, status: 201, data: { challan, releases } };
};

// The owner's challan reference: Core hashes it, logs it to HCS, and schedules the releases
export const recordChallan = async (
  month: string,
  challanRef: string
): Promise<CoreResult<ChallanRecorded>> => {
  if (isMockMode()) return mockRecord(month);
  const base = coreBase();
  if (!base) return notConfigured;
  const body = { receiverId: consoleReceiverId(), month, challanRef };
  return sendParsed('post', URLS.core.challans(base), body, challanRecordedSchema);
};

// Releases for this receiver, or for one agent across every receiver it paid
export const getReleases = async (
  scope: { receiverId: string } | { agentId: string }
): Promise<CoreResult<ReleaseRow[]>> => {
  const keep = (row: ReleaseRow) => !('agentId' in scope) || row.agentId === scope.agentId;
  if (isMockMode()) return ok(mock.releases.filter(keep));
  const base = coreBase();
  if (!base) return notConfigured;
  const query: Record<string, string> =
    'receiverId' in scope ? { receiverId: scope.receiverId } : {};
  const rows = await getParsed(URLS.core.releases(base, query), z.array(releaseRowSchema));
  return rows.ok ? ok(rows.data.filter(keep)) : rows;
};

export const getReceiverReleases = (): Promise<CoreResult<ReleaseRow[]>> =>
  getReleases({ receiverId: consoleReceiverId() });

// Hands Core the agent's signed ScheduleSignTransaction; with both keys the release runs
export const sendCosign = async (
  releaseId: string,
  transaction: string
): Promise<CoreResult<ReleaseRow>> => {
  if (isMockMode()) {
    const index = mock.releases.findIndex((row) => row.id === releaseId);
    const release = mock.releases[index];
    if (!release) return refuse(NOT_FOUND, `no release ${releaseId}`);
    if (release.status !== 'scheduled') return refuse(CONFLICT, `release is ${release.status}`);
    const done = { ...release, status: 'executed' as const, cosignedBy: DEMO_SIGNER };
    mock.releases[index] = done;
    return ok(done);
  }
  const base = coreBase();
  if (!base) return notConfigured;
  return sendParsed(
    'post',
    URLS.core.releaseCosign(base, releaseId),
    { transaction },
    releaseRowSchema
  );
};
