import { classifyOutsidePayment } from '@/lib/core.server';
import { RECEIVER_EDITORS, requireWorkspace } from '@/lib/route-guard.server';
import { outsideClassifySchema } from '@kosha/shared/tax-reports';

const BAD_REQUEST = 400;

type Context = RouteContext<'/api/outside-payments/[id]/classify'>;

// The owner classifies a flagged transfer. The body is checked here; Core checks it again.
export const POST = async (request: Request, context: Context) => {
  const denied = await requireWorkspace(RECEIVER_EDITORS);
  if (denied) return denied;
  const { id } = await context.params;
  const body: unknown = await request.json().catch(() => null);
  const classification = outsideClassifySchema.safeParse(body);
  if (!classification.success) {
    const message = classification.error.issues[0]?.message ?? 'that is not a classification';
    return Response.json({ message }, { status: BAD_REQUEST });
  }
  const saved = await classifyOutsidePayment(id, classification.data);
  return Response.json(saved.data, { status: saved.ok ? 200 : saved.status || 502 });
};
