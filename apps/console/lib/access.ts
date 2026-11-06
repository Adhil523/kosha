import { ROUTES } from '@/lib/routes';
import { WORKSPACE_ORDER, type WorkspaceId, WORKSPACES } from '@/lib/workspaces';

export type Access = { action: 'allow' } | { action: 'redirect'; to: string };

const ALLOW: Access = { action: 'allow' };

const workspaceOf = (pathname: string): WorkspaceId | undefined =>
  WORKSPACE_ORDER.find((id) =>
    WORKSPACES[id].nav.some(
      (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
    )
  );

// Who may see which path. With demo auth off, everything is open (local development).
export const resolveAccess = ({
  pathname,
  role,
  demoAuth
}: {
  pathname: string;
  role: WorkspaceId | null;
  demoAuth: boolean;
}): Access => {
  if (!demoAuth || pathname === ROUTES.signIn) {
    return ALLOW;
  }
  if (!role) {
    return { action: 'redirect', to: ROUTES.signIn };
  }
  if (pathname === ROUTES.home) {
    return { action: 'redirect', to: WORKSPACES[role].home };
  }
  const owner = workspaceOf(pathname);
  if (owner && owner !== role) {
    return { action: 'redirect', to: WORKSPACES[role].home };
  }
  return ALLOW;
};
