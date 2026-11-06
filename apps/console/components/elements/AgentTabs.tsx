'use client';

import { QueryError, QueryPending } from '@/components/elements/QueryStatus';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { agentShortLabel } from '@/lib/agents';
import { getAgentsQueryParams } from '@/lib/queries';
import { TEST_IDS } from '@/lib/test-ids';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode } from 'react';

// One tab per agent; only the open tab's panel is mounted, so only its data is fetched
export const AgentTabs = ({ children }: { children: (agentId: string) => ReactNode }) => {
  const agents = useQuery(getAgentsQueryParams());

  if (agents.isPending) return <QueryPending label="agents" />;
  if (agents.error) {
    return <QueryError error={agents.error} onRetry={() => void agents.refetch()} />;
  }
  const [first] = agents.data;
  if (!first) return <p className="text-sm text-muted-foreground">No agents registered yet.</p>;

  return (
    <Tabs defaultValue={first.agentId} className="flex flex-col gap-4">
      <TabsList>
        {agents.data.map((agent) => (
          <TabsTrigger
            key={agent.agentId}
            value={agent.agentId}
            data-testid={TEST_IDS.agentTab(agent.agentId)}
          >
            {agentShortLabel(agent)}
          </TabsTrigger>
        ))}
      </TabsList>
      {agents.data.map((agent) => (
        <TabsContent key={agent.agentId} value={agent.agentId}>
          {children(agent.agentId)}
        </TabsContent>
      ))}
    </Tabs>
  );
};
