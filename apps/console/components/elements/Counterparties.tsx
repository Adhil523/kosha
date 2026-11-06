'use client';

import { QueryError, QueryPending } from '@/components/elements/QueryStatus';
import { PayerCounter } from '@/components/elements/ThresholdCounter';
import { Badge } from '@/components/ui/badge';
import * as Card from '@/components/ui/card';
import { LEVEL_LABELS, RESIDENCY_LABELS } from '@/lib/payer-labels';
import { getAggregatesQueryParams } from '@/lib/queries';
import { TEST_IDS } from '@/lib/test-ids';
import { POLL_FALLBACK_MS, useLiveStream } from '@/lib/use-live-stream';
import { useQuery } from '@tanstack/react-query';

// Every payer of this receiver: yearly total against the receiver's threshold, with who they
// are (residency) and how far they have verified (level)
export const Counterparties = ({ fxInrPerUsd }: { fxInrPerUsd: string }) => {
  const streaming = useLiveStream();
  const aggregates = useQuery({
    ...getAggregatesQueryParams(),
    refetchInterval: streaming ? false : POLL_FALLBACK_MS
  });

  if (aggregates.isPending) return <QueryPending label="payers" />;
  if (aggregates.error) {
    return <QueryError error={aggregates.error} onRetry={() => void aggregates.refetch()} />;
  }
  if (aggregates.data.length === 0) {
    return <p className="text-sm text-muted-foreground">No payers this financial year yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {aggregates.data.map((row) => (
        <Card.Card key={row.agentId} data-testid={TEST_IDS.counterparty(row.agentId)}>
          <Card.CardHeader className="flex flex-row flex-wrap items-center gap-2">
            <Badge variant="outline">{RESIDENCY_LABELS[row.payerResidency]}</Badge>
            <Badge variant={row.agentLevel === 0 ? 'outline' : 'secondary'}>
              {LEVEL_LABELS[row.agentLevel]}
            </Badge>
            <span className="text-xs text-muted-foreground">FY {row.fy}</span>
          </Card.CardHeader>
          <Card.CardContent>
            <PayerCounter row={row} fxInrPerUsd={fxInrPerUsd} />
          </Card.CardContent>
        </Card.Card>
      ))}
    </div>
  );
};
