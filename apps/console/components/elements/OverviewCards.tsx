'use client';

import { QueryError, QueryPending } from '@/components/elements/QueryStatus';
import * as Card from '@/components/ui/card';
import { getOverviewQueryParams } from '@/lib/queries';
import { TEST_IDS } from '@/lib/test-ids';
import { POLL_FALLBACK_MS } from '@/lib/use-live-stream';
import { type Amount, amountToBigint, formatUsdc } from '@kosha/shared/money';
import { useQuery } from '@tanstack/react-query';
import { cn } from 'cn';
import { Activity, CalendarDays, Landmark, type LucideIcon, Wallet } from 'lucide-react';

type Stat = {
  id: string;
  label: string;
  value: string;
  unit?: string;
  hint: string;
  icon: LucideIcon;
  live?: boolean;
};

// A pulsing dot while the event stream is connected, a hollow one while polling
const LiveDot = ({ live }: { live: boolean }) => (
  <span className="relative flex size-2">
    {live && (
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
    )}
    <span
      className={cn(
        'relative inline-flex size-2 rounded-full',
        live ? 'bg-success' : 'border border-muted-foreground'
      )}
    />
  </span>
);

const StatCard = ({ stat }: { stat: Stat }) => (
  <Card.Card data-testid={TEST_IDS.overviewStat(stat.id)}>
    <Card.CardHeader>
      <Card.CardDescription className="font-medium">{stat.label}</Card.CardDescription>
      <Card.CardAction>
        <stat.icon className="size-4 text-muted-foreground" aria-hidden />
      </Card.CardAction>
    </Card.CardHeader>
    <Card.CardContent className="flex flex-col gap-1">
      <p className="text-3xl font-semibold tracking-tight tabular-nums">
        {stat.value}
        {stat.unit && (
          <span className="ml-1.5 text-sm font-medium text-muted-foreground">{stat.unit}</span>
        )}
      </p>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        {stat.live !== undefined && <LiveDot live={stat.live} />}
        {stat.hint}
      </p>
    </Card.CardContent>
  </Card.Card>
);

const usdc = (micro: Amount) => formatUsdc(amountToBigint(micro));
const USDC_UNIT = 'USDC';

export const OverviewCards = ({ streaming }: { streaming: boolean }) => {
  const overview = useQuery({
    ...getOverviewQueryParams(),
    refetchInterval: streaming ? false : POLL_FALLBACK_MS
  });

  if (overview.isPending) return <QueryPending label="the overview" />;
  if (overview.error) {
    return <QueryError error={overview.error} onRetry={() => void overview.refetch()} />;
  }

  const { data } = overview;
  const stats: Stat[] = [
    {
      id: 'today',
      label: 'Earned today',
      value: usdc(data.todayMicro),
      unit: USDC_UNIT,
      hint: 'Net prices, IST day',
      icon: Wallet
    },
    {
      id: 'month',
      label: 'Earned this month',
      value: usdc(data.monthMicro),
      unit: USDC_UNIT,
      hint: 'Net prices, IST month',
      icon: CalendarDays
    },
    {
      id: 'tds',
      label: 'TDS reserved by payers',
      value: usdc(data.tdsMonthMicro),
      unit: USDC_UNIT,
      hint: "This month, held in each payer's own reserve",
      icon: Landmark
    },
    {
      id: 'rate',
      label: 'Payments per minute',
      value: String(data.paymentsLastMinute),
      hint: streaming ? 'Live, last 60 seconds' : 'Last 60 seconds, polling',
      icon: Activity,
      live: streaming
    }
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <StatCard key={stat.id} stat={stat} />
      ))}
    </div>
  );
};
