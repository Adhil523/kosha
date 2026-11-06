import { getOutsidePayments } from '@/lib/core.server';
import { RECEIVER_VIEWERS, requireWorkspace } from '@/lib/route-guard.server';

// Transfers from a declared payer straight to this receiver's wallet, outside Kosha (A19)
export const GET = async () => {
  const denied = await requireWorkspace(RECEIVER_VIEWERS);
  if (denied) return denied;
  const rows = await getOutsidePayments();
  return Response.json(rows.data, { status: rows.ok ? 200 : rows.status || 502 });
};
