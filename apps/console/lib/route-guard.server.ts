import 'server-only';
import { isDemoAuthEnabled } from '@/lib/session';
import { readSession } from '@/lib/session.server';
import { type WorkspaceId } from '@/lib/workspaces';

// The proxy skips /api, so each route handler checks the demo session itself. With demo auth
// off (local development), every route is open, matching resolveAccess().
export const requireWorkspace = async (
  allowed: readonly WorkspaceId[]
): Promise<Response | null> => {
  if (!isDemoAuthEnabled()) return null;
  const role = await readSession();
  if (role && allowed.includes(role)) return null;
  return Response.json({ message: 'sign in to a workspace that can see this' }, { status: 401 });
};

// API-owner data: the owner's workspace and the CA's read-only filing view
export const RECEIVER_VIEWERS: readonly WorkspaceId[] = ['owner', 'ca'];
// Agent-owner data: agents, reserves, spend and policies
export const AGENT_VIEWERS: readonly WorkspaceId[] = ['agent'];
