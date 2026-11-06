import { SideNav } from '@/components/elements/SideNav';
import { WorkspaceNav } from '@/components/elements/WorkspaceNav';
import { Suspense } from 'react';

const WorkspaceLayout = ({ children }: LayoutProps<'/'>) => (
  <div className="flex min-h-full flex-1">
    <aside className="w-60 shrink-0 border-r bg-sidebar">
      <p className="px-6 pt-6 text-lg font-semibold">Kosha</p>
      {/* The session cookie makes the nav dynamic; the rest of the shell stays static. */}
      <Suspense fallback={<SideNav workspaces={[]} />}>
        <WorkspaceNav />
      </Suspense>
    </aside>
    <main className="flex-1 p-8">{children}</main>
  </div>
);

export default WorkspaceLayout;
