import { openTdsExport } from '@/lib/core.server';
import { RECEIVER_VIEWERS, requireWorkspace } from '@/lib/route-guard.server';
import { quarterSchema } from '@kosha/shared/tax-reports';

const BAD_REQUEST = 400;

// The quarter's TDS file, streamed from Core as a download (RFC 4180 CSV, A15's columns)
export const GET = async (request: Request) => {
  const denied = await requireWorkspace(RECEIVER_VIEWERS);
  if (denied) return denied;
  const quarter = quarterSchema.safeParse(new URL(request.url).searchParams.get('quarter'));
  if (!quarter.success) {
    return Response.json({ message: 'pass ?quarter= like 2026-Q3' }, { status: BAD_REQUEST });
  }
  const file = await openTdsExport(quarter.data);
  if (!file.ok) return Response.json(file.data, { status: file.status || 502 });
  return new Response(file.data, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="kosha-tds-${quarter.data}.csv"`
    }
  });
};
