'use client';

import { QueryError, QueryPending } from '@/components/elements/QueryStatus';
import { Badge } from '@/components/ui/badge';
import * as Card from '@/components/ui/card';
import { formatConsensusTime, reserveLabel } from '@/lib/payment-format';
import { getLedgerQueryParams } from '@/lib/queries';
import { ROUTES } from '@/lib/routes';
import { TEST_IDS } from '@/lib/test-ids';
import { POLL_FALLBACK_MS } from '@/lib/use-live-stream';
import type { LedgerRow } from '@kosha/shared/console-api';
import { amountToBigint, formatUsdc } from '@kosha/shared/money';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, ExternalLink } from 'lucide-react';
import Link from 'next/link';

const RECENT_LIMIT = 6;

const RecentRow = ({ row }: { row: LedgerRow }) => {
  const tds = amountToBigint(row.tdsMicro);
  return (
    <li className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span className="truncate">{row.agentLabel}</span>
          {row.sample && <Badge variant="outline">sample</Badge>}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatConsensusTime(row.consensusAt)}
        </span>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="text-sm font-semibold tabular-nums">
          +{formatUsdc(amountToBigint(row.priceMicro))}
        </span>
        <Badge variant={tds > 0n ? 'default' : 'outline'}>{reserveLabel(row.rateBps)}</Badge>
      </div>
      <a
        href={row.hashscanUrl}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${row.agentLabel}'s payment on HashScan`}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        data-testid={TEST_IDS.recentPaymentLink(row.paymentId)}
      >
        <ExternalLink className="size-4" aria-hidden />
      </a>
    </li>
  );
};

// The latest few payments beside the counter, so a crossing and its HashScan proof share one screen
export const RecentPayments = ({ streaming }: { streaming: boolean }) => {
  const ledger = useQuery({
    ...getLedgerQueryParams(),
    refetchInterval: streaming ? false : POLL_FALLBACK_MS
  });

  return (
    <Card.Card data-testid={TEST_IDS.recentPayments}>
      <Card.CardHeader>
        <Card.CardTitle>Recent payments</Card.CardTitle>
        <Card.CardDescription>
          Net price in USDC, and the TDS each payer reserved
        </Card.CardDescription>
        <Card.CardAction>
          <Link
            href={ROUTES.owner.payments}
            className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
            data-testid={TEST_IDS.recentPaymentsAll}
          >
            View all
            <ArrowUpRight className="size-4" aria-hidden />
          </Link>
        </Card.CardAction>
      </Card.CardHeader>
      <Card.CardContent>
        {ledger.isPending && <QueryPending label="payments" />}
        {ledger.error && <QueryError error={ledger.error} onRetry={() => void ledger.refetch()} />}
        {ledger.data?.rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No payments yet.</p>
        )}
        {ledger.data && (
          <ul className="flex flex-col divide-y">
            {ledger.data.rows.slice(0, RECENT_LIMIT).map((row) => (
              <RecentRow key={row.paymentId} row={row} />
            ))}
          </ul>
        )}
      </Card.CardContent>
    </Card.Card>
  );
};
