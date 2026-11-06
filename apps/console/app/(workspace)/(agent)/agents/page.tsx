import { AgentsList } from '@/components/elements/AgentsList';
import { ROUTES } from '@/lib/routes';
import { TEST_IDS } from '@/lib/test-ids';
import { findNavItem } from '@/lib/workspaces';

const AgentsPage = () => (
  <div className="flex flex-col gap-6">
    <h1 data-testid={TEST_IDS.pageTitle} className="text-2xl font-semibold tracking-tight">
      {findNavItem(ROUTES.agent.agents)?.label}
    </h1>
    <AgentsList />
  </div>
);

export default AgentsPage;
