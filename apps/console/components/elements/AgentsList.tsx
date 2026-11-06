'use client';

import { QueryError, QueryPending } from '@/components/elements/QueryStatus';
import { Badge } from '@/components/ui/badge';
import * as Card from '@/components/ui/card';
import { type AgentView } from '@/lib/agents';
import { LEVEL_LABELS, RESIDENCY_LABELS } from '@/lib/payer-labels';
import { formatConsensusTime } from '@/lib/payment-format';
import { getAgentsQueryParams } from '@/lib/queries';
import { TEST_IDS } from '@/lib/test-ids';
import { URLS } from '@/lib/urls';
import { formatUsdc } from '@kosha/shared/money';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode } from 'react';

const AccountLink = ({ accountId }: { accountId: string }) => (
  <a
    href={URLS.hashscan.account(accountId)}
    target="_blank"
    rel="noreferrer"
    className="font-mono text-sm underline-offset-4 hover:underline"
  >
    {accountId}
  </a>
);

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex flex-col gap-1">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="flex flex-wrap items-center gap-2 text-sm">{children}</dd>
  </div>
);

// A Level 0 agent pays 20% once past the receiver's tolerance; Level 1 brings it down to 1%
const VerifyPrompt = ({ agentId }: { agentId: string }) => (
  <p
    data-testid={TEST_IDS.verifyPrompt(agentId)}
    className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
  >
    Unverified: once this agent passes an API owner&apos;s tolerance it pays 20% TDS. Verify to
    Level 1 (PAN or a non-resident declaration) to drop to 1%.
  </p>
);

const AgentCard = ({ agent }: { agent: AgentView }) => (
  <Card.Card data-testid={TEST_IDS.agentCard(agent.agentId)}>
    <Card.CardHeader className="flex flex-col gap-2">
      <Card.CardTitle className="font-mono text-sm break-all">{agent.identity}</Card.CardTitle>
      <div className="flex flex-wrap gap-2">
        <Badge variant={agent.level === 0 ? 'outline' : 'secondary'}>
          {LEVEL_LABELS[agent.level]}
        </Badge>
        <Badge variant="outline">{RESIDENCY_LABELS[agent.residency]}</Badge>
      </div>
    </Card.CardHeader>
    <Card.CardContent className="flex flex-col gap-4">
      {agent.level === 0 ? <VerifyPrompt agentId={agent.agentId} /> : null}
      <dl className="grid gap-4 sm:grid-cols-2">
        <Field label="Credential">
          {agent.credentialIssuer ? (
            <>
              <span className="font-mono break-all">{agent.credentialIssuer}</span>
              {agent.verifiedAt ? (
                <span className="text-muted-foreground">
                  verified {formatConsensusTime(agent.verifiedAt)}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-muted-foreground">None</span>
          )}
        </Field>
        <Field label="Declared wallets">
          {agent.wallets.map((wallet) => (
            <AccountLink key={wallet} accountId={wallet} />
          ))}
        </Field>
        <Field label="TDS reserve (2-of-2: agent and Kosha)">
          {agent.reserveAccountId ? (
            <AccountLink accountId={agent.reserveAccountId} />
          ) : (
            <span className="text-muted-foreground">Created at the first quote</span>
          )}
        </Field>
        <Field label="Reserve balance">
          {agent.reserveBalanceMicro === null ? (
            <span className="text-muted-foreground">Unavailable</span>
          ) : (
            <span className="tabular-nums">
              {formatUsdc(BigInt(agent.reserveBalanceMicro))} USDC
            </span>
          )}
        </Field>
      </dl>
    </Card.CardContent>
  </Card.Card>
);

// Every agent this owner runs: identity, verification level, credential, wallets and reserve
export const AgentsList = () => {
  const agents = useQuery(getAgentsQueryParams());

  if (agents.isPending) return <QueryPending label="agents" />;
  if (agents.error) {
    return <QueryError error={agents.error} onRetry={() => void agents.refetch()} />;
  }
  if (agents.data.length === 0) {
    return <p className="text-sm text-muted-foreground">No agents registered yet.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {agents.data.map((agent) => (
        <AgentCard key={agent.agentId} agent={agent} />
      ))}
    </div>
  );
};
