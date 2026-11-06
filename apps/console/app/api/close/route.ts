import { getMonthlyClose } from '@/lib/close.server';
import { RECEIVER_VIEWERS, requireWorkspace } from '@/lib/route-guard.server';
import { monthSchema } from '@kosha/shared/tax-reports';

const BAD_REQUEST = 400;

// One month's TDS for this receiver, per payer: what the deductor pays on the income-tax portal
export const GET = async (request: Request) => {
  const denied = await requireWorkspace(RECEIVER_VIEWERS);
  if (denied) return denied;
  const month = monthSchema.safeParse(new URL(request.url).searchParams.get('month'));
  if (!month.success) {
    return Response.json({ message: 'pass ?month= like 2026-11' }, { status: BAD_REQUEST });
  }
  const close = await getMonthlyClose(month.data);
  return Response.json(close.data, { status: close.ok ? 200 : close.status || 502 });
};
