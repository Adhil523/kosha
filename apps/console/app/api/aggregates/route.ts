import { getAggregates } from '@/lib/core.server';
import { RECEIVER_VIEWERS, requireWorkspace } from '@/lib/route-guard.server';

// This financial year's total per payer, against the receiver's threshold
export const GET = async () => {
  const denied = await requireWorkspace(RECEIVER_VIEWERS);
  if (denied) return denied;
  const aggregates = await getAggregates();
  return Response.json(aggregates.data, { status: aggregates.ok ? 200 : aggregates.status || 502 });
};
