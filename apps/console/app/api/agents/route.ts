import { getAgentViews } from '@/lib/agents.server';
import { AGENT_VIEWERS, requireWorkspace } from '@/lib/route-guard.server';

// Every agent with its level, credential, wallets, and its reserve's balance
export const GET = async () => {
  const denied = await requireWorkspace(AGENT_VIEWERS);
  if (denied) return denied;
  const agents = await getAgentViews();
  return Response.json(agents.data, { status: agents.ok ? 200 : agents.status || 502 });
};
