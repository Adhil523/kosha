import { getReleases } from '@/lib/close.server';
import { AGENT_VIEWERS, requireWorkspace } from '@/lib/route-guard.server';

type Context = RouteContext<'/api/agents/[id]/releases'>;

// The releases out of this agent's reserve, across every receiver it paid
export const GET = async (_request: Request, context: Context) => {
  const denied = await requireWorkspace(AGENT_VIEWERS);
  if (denied) return denied;
  const { id } = await context.params;
  const releases = await getReleases({ agentId: id });
  return Response.json(releases.data, { status: releases.ok ? 200 : releases.status || 502 });
};
