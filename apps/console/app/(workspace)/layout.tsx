import { SideNav } from '@/components/elements/SideNav';
import { WORKSPACE_ORDER, WORKSPACES } from '@/lib/workspaces';

const WorkspaceLayout = ({ children }: LayoutProps<'/'>) => (
  <div className="flex min-h-full flex-1">
    <aside className="w-60 shrink-0 border-r bg-sidebar">
      <p className="px-6 pt-6 text-lg font-semibold">Kosha</p>
      <SideNav workspaces={WORKSPACE_ORDER.map((id) => WORKSPACES[id])} />
    </aside>
    <main className="flex-1 p-8">{children}</main>
  </div>
);

export default WorkspaceLayout;
