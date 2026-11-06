import { getOverview } from '@/lib/core.server';
import { RECEIVER_VIEWERS, requireWorkspace } from '@/lib/route-guard.server';

// Earnings today and this month, TDS reserved this month and the live payment rate
export const GET = async () => {
  const denied = await requireWorkspace(RECEIVER_VIEWERS);
  if (denied) return denied;
  const overview = await getOverview(new Date());
  return Response.json(overview.data, { status: overview.ok ? 200 : overview.status || 502 });
};
