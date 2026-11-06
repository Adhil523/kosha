import 'server-only';
import { parseRole, SESSION_COOKIE } from '@/lib/session';
import { type WorkspaceId } from '@/lib/workspaces';
import { cookies } from 'next/headers';

export const readSession = async (): Promise<WorkspaceId | null> => {
  const store = await cookies();
  return parseRole(store.get(SESSION_COOKIE)?.value);
};
