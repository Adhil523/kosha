'use client';

import { QueryError, QueryPending } from '@/components/elements/QueryStatus';
import { Badge } from '@/components/ui/badge';
import * as Card from '@/components/ui/card';
import { ProgressIndicator, ProgressTrack } from '@/components/ui/progress';
import * as Tooltip from '@/components/ui/tooltip';
import { getAggregatesQueryParams } from '@/lib/queries';
import { TEST_IDS } from '@/lib/test-ids';
import { counterState, paiseToMicro, parseFxPaisePerUsd } from '@/lib/threshold';
import { POLL_FALLBACK_MS } from '@/lib/use-live-stream';
import { Progress as ProgressPrimitive } from '@base-ui/react/progress';
import type { AggregateRow } from '@kosha/shared/console-api';
import { amountToBigint, formatInr, formatUsdc } from '@kosha/shared/money';
import { useQuery } from '@tanstack/react-query';
import { cn } from 'cn';

type MoneyProps = { paise: bigint; fxInrPerUsd: string };

// Rupees first (the law counts in ₹), USDC beside it, and the rate on hover
const Money = ({ paise, fxInrPerUsd }: MoneyProps) => {
  const fx = parseFxPaisePerUsd(fxInrPerUsd);
  if (!fx) return <span>{formatInr(paise)}</span>;
  return (
    <Tooltip.Tooltip>
      <Tooltip.TooltipTrigger render={<span className="cursor-help underline decoration-dotted" />}>
        {formatInr(paise)} ≈ {formatUsdc(paiseToMicro(paise, fx))} USDC
      </Tooltip.TooltipTrigger>
      <Tooltip.TooltipContent>At ₹{fxInrPerUsd} per USD</Tooltip.TooltipContent>
    </Tooltip.Tooltip>
  );
};

const PayerCounter = ({ row, fxInrPerUsd }: { row: AggregateRow; fxInrPerUsd: string }) => {
  const state = counterState(row);
  const value = amountToBigint(row.valuePaise) + amountToBigint(row.outsideValuePaise);
  return (
    <div className="flex flex-col gap-2" data-testid={TEST_IDS.thresholdCounter(row.agentId)}>
      <div className="flex items-center justify-between gap-4 text-sm">
        <span className="font-medium">{row.agentId}</span>
        <Badge
          variant={state.crossed ? 'default' : 'outline'}
          className={cn(state.near && !state.crossed && 'border-warning text-warning')}
          data-testid={TEST_IDS.thresholdStatus(row.agentId)}
        >
          {state.status}
        </Badge>
      </div>
      <ProgressPrimitive.Root
        value={state.fillPct}
        aria-label={`${row.agentId} towards the threshold`}
      >
        <ProgressTrack className="relative h-2.5 overflow-visible">
          <ProgressIndicator className={cn(state.near ? 'bg-warning' : 'bg-primary')} />
          {state.tolerancePct !== null && (
            <span
              className="absolute -top-1 h-4.5 w-0.5 bg-foreground"
              style={{ left: `${state.tolerancePct}%` }}
              title="Tolerance for unverified payers"
            />
          )}
        </ProgressTrack>
      </ProgressPrimitive.Root>
      <p className="text-xs text-muted-foreground">
        <Money paise={value} fxInrPerUsd={fxInrPerUsd} /> of{' '}
        <Money paise={amountToBigint(row.thresholdPaise)} fxInrPerUsd={fxInrPerUsd} /> this FY
        {row.tolerancePaise !== null && (
          <>
            {' '}
            · tolerance{' '}
            <Money paise={amountToBigint(row.tolerancePaise)} fxInrPerUsd={fxInrPerUsd} />
          </>
        )}
      </p>
    </div>
  );
};

// Each payer's yearly total against this receiver's threshold (₹10,000, or ₹50,000 when the API
// owner is a specified person), turning amber at 90% of the nearer limit
export const ThresholdCounter = ({
  streaming,
  fxInrPerUsd
}: {
  streaming: boolean;
  fxInrPerUsd: string;
}) => {
  const aggregates = useQuery({
    ...getAggregatesQueryParams(),
    refetchInterval: streaming ? false : POLL_FALLBACK_MS
  });

  return (
    <Card.Card>
      <Card.CardHeader>
        <Card.CardTitle>Threshold counter</Card.CardTitle>
        <Card.CardDescription>
          Each payer this financial year, against your TDS threshold
        </Card.CardDescription>
      </Card.CardHeader>
      <Card.CardContent className="flex flex-col gap-5">
        {aggregates.isPending && <QueryPending label="payer totals" />}
        {aggregates.error && (
          <QueryError error={aggregates.error} onRetry={() => void aggregates.refetch()} />
        )}
        {aggregates.data?.map((row) => (
          <PayerCounter key={row.agentId} row={row} fxInrPerUsd={fxInrPerUsd} />
        ))}
      </Card.CardContent>
    </Card.Card>
  );
};
