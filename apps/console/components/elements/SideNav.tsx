'use client';

import { TEST_IDS } from '@/lib/test-ids';
import { cn } from '@/lib/utils';
import { type Workspace } from '@/lib/workspaces';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type SideNavProps = { workspaces: Workspace[] };

export const SideNav = ({ workspaces }: SideNavProps) => {
  const pathname = usePathname();

  return (
    <nav data-testid={TEST_IDS.sideNav} className="flex flex-col gap-6 p-4">
      {workspaces.map((workspace) => (
        <div key={workspace.id} className="flex flex-col gap-1">
          <p className="px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {workspace.label}
          </p>
          {workspace.nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              data-testid={TEST_IDS.navLink(item.href)}
              aria-current={pathname === item.href ? 'page' : undefined}
              className={cn(
                'rounded-md px-2 py-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent',
                pathname === item.href && 'bg-sidebar-accent font-medium'
              )}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
};
