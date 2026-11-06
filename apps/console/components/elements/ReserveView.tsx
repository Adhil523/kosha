'use client';

import { cosignAsDemoSigner } from '@/app/(workspace)/(agent)/reserve/actions';
import { QueryError, QueryPending } from '@/components/elements/QueryStatus';
import { ReleasesTable } from '@/components/elements/ReleasesTable';
import { Button } from '@/components/ui/button';
import * as Card from '@/components/ui/card';
import { DEMO_SIGNER_LABEL } from '@/lib/demo-signer';
import { getAgentReleasesQueryParams, getAgentsQueryParams } from '@/lib/queries';
import { QUERY_KEYS } from '@/lib/query-client';
import { TEST_IDS } from '@/lib/test-ids';
import { URLS } from '@/lib/urls';
import { formatUsdc } from '@kosha/shared/money';
import { type ReleaseRow } from '@kosha/shared/tax-reports';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

const cosign = async (agentId: string, releaseId: string): Promise<ReleaseRow> => {
  const result = await cosignAsDemoSigner(agentId, releaseId);
  if (!result.ok) throw new Error(result.data.message || `not co-signed (${result.status})`);
  return result.data;
};

const CosignButton = ({ agentId, release }: { agentId: string; release: ReleaseRow }) => {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () => cosign(agentId, release.id),
    onSuccess: async (row) => {
      toast.success(
        row.status === 'executed'
          ? 'Co-signed. The reserve paid the TDS to the API owner.'
          : 'Co-signed. Hedera runs the release once the schedule has both keys.'
      );
      // The reserve's balance drops once the release runs
      await Promise.all(
        [QUERY_KEYS.agentReleases(agentId), QUERY_KEYS.agents, QUERY_KEYS.releases].map(
          (queryKey) => queryClient.invalidateQueries({ queryKey })
        )
      );
    },
    onError: (error) => toast.error(`Not co-signed: ${error.message}`)
  });

  if (release.status !== 'scheduled') return null;
  return (
    <Button
      size="sm"
      disabled={save.isPending}
      onClick={() => save.mutate()}
      data-testid={TEST_IDS.releaseCosign(release.id)}
    >
      {save.isPending ? 'Signing…' : `Co-sign release (${DEMO_SIGNER_LABEL})`}
    </Button>
  );
};

// The agent's reserve: what it holds, and the releases waiting on the agent operator's key
export const ReserveView = ({ agentId }: { agentId: string }) => {
  const agents = useQuery(getAgentsQueryParams());
  const releases = useQuery(getAgentReleasesQueryParams(agentId));
  const failed = agents.error ?? releases.error;
  if (failed) {
    const retry = () => void Promise.all([agents.refetch(), releases.refetch()]);
    return <QueryError error={failed} onRetry={retry} />;
  }
  if (!agents.data || !releases.data) return <QueryPending label="the reserve" />;
  const rows = releases.data;
  const agent = agents.data.find((row) => row.agentId === agentId);
  if (!agent?.reserveAccountId) {
    return (
      <p className="text-sm text-muted-foreground">
        This agent has no reserve yet. Core opens one at its first quote.
      </p>
    );
  }
  const waiting = rows.filter((row) => row.status === 'scheduled');
  const waitingMicro = waiting.reduce((sum, row) => sum + BigInt(row.micro), 0n);

  return (
    <div className="flex flex-col gap-4">
      <Card.Card>
        <Card.CardHeader>
          <Card.CardDescription>
            Reserve{' '}
            <a
              href={URLS.hashscan.account(agent.reserveAccountId)}
              target="_blank"
              rel="noreferrer"
              className="font-mono underline-offset-4 hover:underline"
            >
              {agent.reserveAccountId}
            </a>{' '}
            · 2-of-2: this agent and Kosha
          </Card.CardDescription>
          <Card.CardTitle
            className="text-xl tabular-nums"
            data-testid={TEST_IDS.reserveBalance(agentId)}
          >
            {agent.reserveBalanceMicro === null
              ? 'Balance unavailable'
              : `${formatUsdc(BigInt(agent.reserveBalanceMicro))} USDC held`}
          </Card.CardTitle>
          <Card.CardDescription>
            {waiting.length === 0
              ? 'Nothing is waiting for your co-sign.'
              : `${waiting.length === 1 ? 'One release' : `${waiting.length} releases`} of ${formatUsdc(waitingMicro)} USDC ${waiting.length === 1 ? 'waits' : 'wait'} for your co-sign.`}{' '}
            The TDS you funded stays here until the API owner records the challan; it then goes to
            them as reimbursement.
          </Card.CardDescription>
        </Card.CardHeader>
      </Card.Card>
      <Card.Card>
        <Card.CardHeader>
          <Card.CardTitle className="text-base">Releases</Card.CardTitle>
          <Card.CardDescription>
            The co-sign here uses the seeded agent&rsquo;s own key on the server, a demo signer
            standing in for the operator&rsquo;s wallet.
          </Card.CardDescription>
        </Card.CardHeader>
        <Card.CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No release has been scheduled yet.</p>
          ) : (
            <ReleasesTable
              releases={rows}
              lead={{ label: 'Challan', cell: (release) => release.challanId }}
              action={(release) => <CosignButton agentId={agentId} release={release} />}
            />
          )}
        </Card.CardContent>
      </Card.Card>
    </div>
  );
};
