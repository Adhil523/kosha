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
import { usePayerLabel } from '@/lib/use-payer-labels';
import { Progress as ProgressPrimitive } from '@base-ui/react/progress';
import type { AggregateRow } from '@kosha/shared/console-api';
import { amountToBigint, formatInr, formatUsdc } from '@kosha/shared/money';
import { useQuery } from '@tanstack/react-query';
import { cn } from 'cn';

type MoneyProps = { paise: bigint; fxInrPerUsd: string; compact?: boolean };

// Rupees first (the law counts in ₹), USDC beside it (or, compact, on hover), and the rate on hover
const Money = ({ paise, fxInrPerUsd, compact = false }: MoneyProps) => {
  const fx = parseFxPaisePerUsd(fxInrPerUsd);
  if (!fx) return <span className="text-foreground">{formatInr(paise)}</span>;
  const usdc = `${formatUsdc(paiseToMicro(paise, fx))} USDC`;
  return (
    <Tooltip.Tooltip>
      <Tooltip.TooltipTrigger render={<span className="cursor-help" />}>
        <span className="font-medium text-foreground">{formatInr(paise)}</span>
        {!compact && <span> ≈ {usdc}</span>}
      </Tooltip.TooltipTrigger>
      <Tooltip.TooltipContent>
        {compact && `≈ ${usdc} · `}At ₹{fxInrPerUsd} per USD
      </Tooltip.TooltipContent>
    </Tooltip.Tooltip>
  );
};

export const PayerCounter = ({
  row,
  label,
  fxInrPerUsd
}: {
  row: AggregateRow;
  label: string;
  fxInrPerUsd: string;
}) => {
  const state = counterState(row);
  const value = amountToBigint(row.valuePaise) + amountToBigint(row.outsideValuePaise);
  return (
    <div
      className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0"
      data-testid={TEST_IDS.thresholdCounter(row.agentId)}
    >
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium break-all">{label}</span>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-sm font-semibold tabular-nums">{Math.round(state.fillPct)}%</span>
          <Badge
            variant={state.crossed ? 'default' : 'outline'}
            className={cn(state.near && !state.crossed && 'border-warning text-warning')}
            data-testid={TEST_IDS.thresholdStatus(row.agentId)}
            data-threshold={state.crossed ? 'crossed' : state.near ? 'near' : 'under'}
          >
            {state.status}
          </Badge>
        </div>
      </div>
      <ProgressPrimitive.Root value={state.fillPct} aria-label={`${label} towards the threshold`}>
        <ProgressTrack className="relative h-2 overflow-visible">
          <ProgressIndicator
            className={cn(
              'transition-all duration-700',
              state.near && !state.crossed ? 'bg-warning' : 'bg-primary'
            )}
          />
          {state.tolerancePct !== null && (
            <span
              className="absolute -top-1 h-4 w-0.5 rounded-full bg-foreground"
              style={{ left: `${state.tolerancePct}%` }}
              title="Tolerance for unverified payers"
            />
          )}
        </ProgressTrack>
      </ProgressPrimitive.Root>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          <Money paise={value} fxInrPerUsd={fxInrPerUsd} /> this FY
        </span>
        <span>
          {row.tolerancePaise !== null && (
            <>
              tolerance{' '}
              <Money paise={amountToBigint(row.tolerancePaise)} fxInrPerUsd={fxInrPerUsd} compact />
              {' · '}
            </>
          )}
          threshold{' '}
          <Money paise={amountToBigint(row.thresholdPaise)} fxInrPerUsd={fxInrPerUsd} compact />
        </span>
      </div>
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
  const labelFor = usePayerLabel();

  return (
    <Card.Card>
      <Card.CardHeader>
        <Card.CardTitle>Threshold counter</Card.CardTitle>
        <Card.CardDescription>
          Each payer this financial year, against your TDS threshold
        </Card.CardDescription>
      </Card.CardHeader>
      <Card.CardContent className="flex flex-col divide-y">
        {aggregates.isPending && <QueryPending label="payer totals" />}
        {aggregates.error && (
          <QueryError error={aggregates.error} onRetry={() => void aggregates.refetch()} />
        )}
        {aggregates.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">No payers yet this financial year.</p>
        )}
        {aggregates.data?.map((row) => (
          <PayerCounter
            key={row.agentId}
            row={row}
            label={labelFor(row.agentId)}
            fxInrPerUsd={fxInrPerUsd}
          />
        ))}
      </Card.CardContent>
    </Card.Card>
  );
};
