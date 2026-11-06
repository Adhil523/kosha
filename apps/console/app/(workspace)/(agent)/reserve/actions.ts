'use server';

import { type ApiError, type ApiResponse } from '@/lib/api';
import { DEMO_SIGNER, getReleases, sendCosign } from '@/lib/close.server';
import { getAgents, isMockMode } from '@/lib/core.server';
import { pickDemoSigner } from '@/lib/demo-signer';
import { signScheduleSign } from '@/lib/demo-signer.server';
import { isDemoAuthEnabled } from '@/lib/session';
import { readSession } from '@/lib/session.server';
import { type ReleaseRow } from '@kosha/shared/tax-reports';

const UNAUTHORIZED = 401;
const NOT_FOUND = 404;
const CONFLICT = 409;

type Cosigned = ApiResponse<ReleaseRow, ApiError>;
const refuse = (status: number, message: string): Cosigned => ({
  ok: false,
  status,
  data: { message }
});

// The agent operator's half of a reserve release, signed here with the seeded agent's own key
// (the demo signer). The browser never sees the key; it only names the release.
export const cosignAsDemoSigner = async (agentId: string, releaseId: string): Promise<Cosigned> => {
  if (isDemoAuthEnabled() && (await readSession()) !== 'agent') {
    return refuse(UNAUTHORIZED, 'sign in as the agent owner to co-sign');
  }
  const releases = await getReleases({ agentId });
  if (!releases.ok) return releases;
  const release = releases.data.find((row) => row.id === releaseId);
  if (!release) return refuse(NOT_FOUND, `no release ${releaseId} for this agent`);
  if (release.status !== 'scheduled' || !release.scheduleId) {
    return refuse(CONFLICT, `the release is ${release.status}, not waiting for a co-sign`);
  }
  // Mock mode has no keys or network: the in-memory release runs at once
  if (isMockMode()) return sendCosign(releaseId, DEMO_SIGNER);

  const agents = await getAgents();
  if (!agents.ok) return agents;
  const agent = agents.data.find((row) => row.agentId === agentId);
  const signer = agent ? pickDemoSigner(process.env, agent.wallets) : null;
  if (!signer) return refuse(NOT_FOUND, 'the demo signer has no key for this agent');
  const signed = await signScheduleSign(release.scheduleId, signer);
  if (!signed.ok) return { ok: false, status: 500, data: signed.data };
  return sendCosign(releaseId, signed.data);
};
