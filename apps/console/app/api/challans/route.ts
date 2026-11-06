import { getChallans, recordChallan } from '@/lib/close.server';
import { RECEIVER_EDITORS, RECEIVER_VIEWERS, requireWorkspace } from '@/lib/route-guard.server';
import { challanRecordSchema } from '@kosha/shared/tax-reports';

const BAD_REQUEST = 400;
// The receiver comes from the session's workspace, never from the browser
const challanFormSchema = challanRecordSchema.omit({ receiverId: true });

export const GET = async () => {
  const denied = await requireWorkspace(RECEIVER_VIEWERS);
  if (denied) return denied;
  const challans = await getChallans();
  return Response.json(challans.data, { status: challans.ok ? 200 : challans.status || 502 });
};

// Records the challan reference for a month (a mock in the demo); Core schedules the releases
export const POST = async (request: Request) => {
  const denied = await requireWorkspace(RECEIVER_EDITORS);
  if (denied) return denied;
  const body: unknown = await request.json().catch(() => null);
  const form = challanFormSchema.safeParse(body);
  if (!form.success) {
    return Response.json(
      { message: 'pass a month and a challan reference' },
      { status: BAD_REQUEST }
    );
  }
  const recorded = await recordChallan(form.data.month, form.data.challanRef);
  return Response.json(recorded.data, {
    status: recorded.ok ? recorded.status : recorded.status || 502
  });
};
