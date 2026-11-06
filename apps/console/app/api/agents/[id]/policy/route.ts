import { getPolicy, putPolicy } from '@/lib/core.server';
import { AGENT_VIEWERS, requireWorkspace } from '@/lib/route-guard.server';
import { policySchema } from '@kosha/shared/registry';

const BAD_REQUEST = 400;

type Context = RouteContext<'/api/agents/[id]/policy'>;

// The agent's spending policy, or null when none is set
export const GET = async (_request: Request, context: Context) => {
  const denied = await requireWorkspace(AGENT_VIEWERS);
  if (denied) return denied;
  const { id } = await context.params;
  const policy = await getPolicy(id);
  return Response.json(policy.data, { status: policy.ok ? 200 : policy.status || 502 });
};

// Replaces the policy. The body is checked here; Core checks it again.
export const PUT = async (request: Request, context: Context) => {
  const denied = await requireWorkspace(AGENT_VIEWERS);
  if (denied) return denied;
  const { id } = await context.params;
  const body: unknown = await request.json().catch(() => null);
  const policy = policySchema.safeParse(body);
  if (!policy.success) {
    return Response.json({ message: 'that is not a valid policy' }, { status: BAD_REQUEST });
  }
  const saved = await putPolicy(id, policy.data);
  return Response.json(saved.data, { status: saved.ok ? 200 : saved.status || 502 });
};
