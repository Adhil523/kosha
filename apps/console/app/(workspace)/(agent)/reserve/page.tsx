'use client';

import { AgentTabs } from '@/components/elements/AgentTabs';
import { ReserveView } from '@/components/elements/ReserveView';
import { ROUTES } from '@/lib/routes';
import { TEST_IDS } from '@/lib/test-ids';
import { findNavItem } from '@/lib/workspaces';

const ReservePage = () => (
  <div className="flex flex-col gap-6">
    <h1 data-testid={TEST_IDS.pageTitle} className="text-2xl font-semibold tracking-tight">
      {findNavItem(ROUTES.agent.reserve)?.label}
    </h1>
    <AgentTabs>{(agentId) => <ReserveView agentId={agentId} />}</AgentTabs>
  </div>
);

export default ReservePage;
