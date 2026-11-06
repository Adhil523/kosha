import { getLedger } from '@/lib/core.server';
import { RECEIVER_VIEWERS, requireWorkspace } from '@/lib/route-guard.server';

// The receiver's latest payments, read from Core with the admin token
export const GET = async () => {
  const denied = await requireWorkspace(RECEIVER_VIEWERS);
  if (denied) return denied;
  const ledger = await getLedger();
  return Response.json(ledger.data, { status: ledger.ok ? 200 : ledger.status || 502 });
};
