'use client';

import { QueryError, QueryPending } from '@/components/elements/QueryStatus';
import { ReleasesTable } from '@/components/elements/ReleasesTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import * as Card from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { challanFor, type Month, monthLabel } from '@/lib/monthly';
import { formatConsensusTime } from '@/lib/payment-format';
import { getChallansQueryParams, getReleasesQueryParams } from '@/lib/queries';
import { QUERY_KEYS } from '@/lib/query-client';
import { TEST_IDS } from '@/lib/test-ids';
import { URLS } from '@/lib/urls';
import { formatInr } from '@kosha/shared/money';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

const record = async (month: Month, challanRef: string): Promise<void> => {
  const response = await api.post<unknown>(URLS.console.challans, { month, challanRef });
  if (!response.ok) throw new Error(response.data.message || `not recorded (${response.status})`);
};

// The owner deposits the month's TDS on the income-tax portal, then records the challan here.
// In the demo nobody deposits anything: the reference is a mock, and the form says so.
const RecordChallan = ({ month }: { month: Month }) => {
  const queryClient = useQueryClient();
  const [challanRef, setChallanRef] = useState('');
  const save = useMutation({
    mutationFn: () => record(month, challanRef.trim()),
    onSuccess: async () => {
      toast.success('Challan recorded. Core scheduled one release per payer reserve.');
      setChallanRef('');
      await Promise.all(
        [QUERY_KEYS.challans, QUERY_KEYS.releases].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey })
        )
      );
    },
    onError: (error) => toast.error(`Challan not recorded: ${error.message}`)
  });

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex items-center gap-2">
        <Label htmlFor="challanRef">Challan reference</Label>
        <Badge variant="outline">Mock: no real deposit in the demo</Badge>
      </div>
      <div className="flex gap-2">
        <Input
          id="challanRef"
          className="max-w-xs"
          placeholder="e.g. BSR 0510002, serial 00042"
          value={challanRef}
          onChange={(event) => setChallanRef(event.target.value)}
          data-testid={TEST_IDS.challanRef}
        />
        <Button
          type="submit"
          disabled={!challanRef.trim() || save.isPending}
          data-testid={TEST_IDS.challanRecord}
        >
          {save.isPending ? 'Recording…' : 'Record challan'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Core stores only a hash of the reference, logs it to HCS, and schedules each payer&rsquo;s
        reserve to release its TDS to you.
      </p>
    </form>
  );
};

// The month's challan, or the form to record it, and the reserve releases that follow it
export const ChallanPanel = ({ month, hasTds }: { month: Month; hasTds: boolean }) => {
  const challans = useQuery(getChallansQueryParams());
  const releases = useQuery(getReleasesQueryParams());

  const failed = challans.error ?? releases.error;
  const retry = () => void Promise.all([challans.refetch(), releases.refetch()]);
  const challan = challans.data ? challanFor(challans.data, month) : null;

  return (
    <Card.Card>
      <Card.CardHeader>
        <Card.CardTitle className="text-base" data-testid={TEST_IDS.challanStatus}>
          {challan
            ? `Challan recorded ${formatConsensusTime(challan.recordedAt)} for ${formatInr(BigInt(challan.tdsPaise))}`
            : `No challan for ${monthLabel(month)} yet`}
        </Card.CardTitle>
        <Card.CardDescription>
          TDS is due on the 7th of the next month. Each payer funded its own TDS into a 2-of-2
          reserve; once the challan is recorded, the reserve pays it back to you.
        </Card.CardDescription>
      </Card.CardHeader>
      <Card.CardContent className="flex flex-col gap-4">
        {challans.isPending || releases.isPending ? <QueryPending label="challans" /> : null}
        {failed ? <QueryError error={failed} onRetry={retry} /> : null}
        {challans.data && !challan && hasTds ? <RecordChallan month={month} /> : null}
        {challan && releases.data ? (
          <ReleasesTable
            releases={releases.data.filter((row) => row.challanId === challan.id)}
            lead={{ label: 'Payer', cell: (release) => release.agentId }}
          />
        ) : null}
      </Card.CardContent>
    </Card.Card>
  );
};
