import 'server-only';
import { isDemoAuthEnabled } from '@/lib/session';
import { readSession } from '@/lib/session.server';
import { type WorkspaceId } from '@/lib/workspaces';
import { connection } from 'next/server';

// The proxy skips /api, so each route handler checks the demo session itself. With demo auth
// off (local development), every route is open, matching resolveAccess().
export const requireWorkspace = async (
  allowed: readonly WorkspaceId[]
): Promise<Response | null> => {
  // Every route behind this guard reads live Core data. With cacheComponents, a GET handler that
  // touches no request data is prerendered at build, so mark each one dynamic here.
  await connection();
  if (!isDemoAuthEnabled()) return null;
  const role = await readSession();
  if (role && allowed.includes(role)) return null;
  return Response.json({ message: 'sign in to a workspace that can see this' }, { status: 401 });
};

// API-owner data: the owner's workspace and the CA's read-only filing view
export const RECEIVER_VIEWERS: readonly WorkspaceId[] = ['owner', 'ca'];
// Agent-owner data: agents, reserves, spend and policies
export const AGENT_VIEWERS: readonly WorkspaceId[] = ['agent'];
