'use client';

import { AgentTabs } from '@/components/elements/AgentTabs';
import { PolicyEditor } from '@/components/elements/PolicyEditor';
import { ROUTES } from '@/lib/routes';
import { TEST_IDS } from '@/lib/test-ids';
import { findNavItem } from '@/lib/workspaces';

const PoliciesPage = () => (
  <div className="flex flex-col gap-6">
    <h1 data-testid={TEST_IDS.pageTitle} className="text-2xl font-semibold tracking-tight">
      {findNavItem(ROUTES.agent.policies)?.label}
    </h1>
    <AgentTabs>{(agentId) => <PolicyEditor agentId={agentId} />}</AgentTabs>
  </div>
);

export default PoliciesPage;
