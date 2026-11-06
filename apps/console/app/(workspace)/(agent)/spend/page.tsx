'use client';

import { AgentTabs } from '@/components/elements/AgentTabs';
import { SpendView } from '@/components/elements/SpendView';
import { ROUTES } from '@/lib/routes';
import { TEST_IDS } from '@/lib/test-ids';
import { findNavItem } from '@/lib/workspaces';

const SpendPage = () => (
  <div className="flex flex-col gap-6">
    <h1 data-testid={TEST_IDS.pageTitle} className="text-2xl font-semibold tracking-tight">
      {findNavItem(ROUTES.agent.spend)?.label}
    </h1>
    <AgentTabs>{(agentId) => <SpendView agentId={agentId} />}</AgentTabs>
  </div>
);

export default SpendPage;
