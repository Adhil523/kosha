'use client';

import { QueryError, QueryPending } from '@/components/elements/QueryStatus';
import * as Card from '@/components/ui/card';
import { getOverviewQueryParams } from '@/lib/queries';
import { TEST_IDS } from '@/lib/test-ids';
import { POLL_FALLBACK_MS } from '@/lib/use-live-stream';
import { type Amount, amountToBigint, formatUsdc } from '@kosha/shared/money';
import { useQuery } from '@tanstack/react-query';

type Stat = { id: string; label: string; value: string; hint: string };

const StatCard = ({ stat }: { stat: Stat }) => (
  <Card.Card data-testid={TEST_IDS.overviewStat(stat.id)}>
    <Card.CardHeader>
      <Card.CardDescription>{stat.label}</Card.CardDescription>
      <Card.CardTitle className="text-2xl tabular-nums">{stat.value}</Card.CardTitle>
    </Card.CardHeader>
    <Card.CardContent className="text-xs text-muted-foreground">{stat.hint}</Card.CardContent>
  </Card.Card>
);

const usdc = (micro: Amount) => `${formatUsdc(amountToBigint(micro))} USDC`;

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
      hint: 'Net prices, IST day'
    },
    {
      id: 'month',
      label: 'Earned this month',
      value: usdc(data.monthMicro),
      hint: 'Net prices, IST month'
    },
    {
      id: 'tds',
      label: 'TDS reserved by payers',
      value: usdc(data.tdsMonthMicro),
      hint: "This month, held in each payer's own reserve"
    },
    {
      id: 'rate',
      label: 'Payments per minute',
      value: String(data.paymentsLastMinute),
      hint: streaming ? 'Live, last 60 seconds' : 'Last 60 seconds, polling'
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
