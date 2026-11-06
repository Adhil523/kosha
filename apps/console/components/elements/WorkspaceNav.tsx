import { signOut } from '@/app/sign-in/actions';
import { SideNav } from '@/components/elements/SideNav';
import { Button } from '@/components/ui/button';
import { readSession } from '@/lib/session.server';
import { TEST_IDS } from '@/lib/test-ids';
import { WORKSPACE_ORDER, WORKSPACES } from '@/lib/workspaces';

// Signed in: only that workspace. Signed out (demo auth off): all of them.
export const WorkspaceNav = async () => {
  const role = await readSession();
  const workspaces = role ? [WORKSPACES[role]] : WORKSPACE_ORDER.map((id) => WORKSPACES[id]);

  return (
    <>
      <SideNav workspaces={workspaces} />
      {role && (
        <form action={signOut} className="px-4">
          <Button type="submit" variant="ghost" size="sm" data-testid={TEST_IDS.signOut}>
            Sign out
          </Button>
        </form>
      )}
    </>
  );
};
