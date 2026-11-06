import { RECEIVER_VIEWERS, requireWorkspace } from '@/lib/route-guard.server';
import { getTaxReport } from '@/lib/tax.server';
import { quarterSchema } from '@kosha/shared/tax-reports';

const BAD_REQUEST = 400;

// One quarter's TDS summary, deductee-wise totals and rule pack, for the tax and filing screens
export const GET = async (request: Request) => {
  const denied = await requireWorkspace(RECEIVER_VIEWERS);
  if (denied) return denied;
  const quarter = quarterSchema.safeParse(new URL(request.url).searchParams.get('quarter'));
  if (!quarter.success) {
    return Response.json({ message: 'pass ?quarter= like 2026-Q3' }, { status: BAD_REQUEST });
  }
  const report = await getTaxReport(quarter.data);
  return Response.json(report.data, { status: report.ok ? 200 : report.status || 502 });
};
