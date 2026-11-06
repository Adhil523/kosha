'use client';

import { QueryError, QueryPending } from '@/components/elements/QueryStatus';
import { Badge } from '@/components/ui/badge';
import * as Table from '@/components/ui/table';
import { formatConsensusTime, REASON_LABELS, reserveLabel } from '@/lib/payment-format';
import { getLedgerQueryParams } from '@/lib/queries';
import { TEST_IDS } from '@/lib/test-ids';
import { POLL_FALLBACK_MS, useLiveStream } from '@/lib/use-live-stream';
import type { TopicId } from '@kosha/shared/ids';
import { mirrorTopicMessage } from '@kosha/shared/links';
import { amountToBigint, formatUsdc } from '@kosha/shared/money';
import { useQuery } from '@tanstack/react-query';

// Where an HCS sequence number links: one message on the Mirror Node, when the topic is known
export type HcsLinkConfig = { mirrorUrl: string; topicId: TopicId } | null;

const hcsMessageUrl = (config: HcsLinkConfig, sequence: number): string | null =>
  config ? mirrorTopicMessage(config.mirrorUrl, config.topicId, sequence) : null;

const COLUMNS = ['Time (IST)', 'Agent', 'Price (USDC)', 'TDS (USDC)', 'Rate', 'Reason', 'Evidence'];

export const PaymentsFeed = ({ hcs }: { hcs: HcsLinkConfig }) => {
  const streaming = useLiveStream();
  const ledger = useQuery({
    ...getLedgerQueryParams(),
    refetchInterval: streaming ? false : POLL_FALLBACK_MS
  });

  return (
    <section className="flex flex-col gap-3" data-testid={TEST_IDS.paymentsFeed}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Live payments</h2>
        <Badge variant={streaming ? 'secondary' : 'outline'} data-testid={TEST_IDS.feedStatus}>
          {streaming ? 'Live' : `Polling every ${POLL_FALLBACK_MS / 1_000} s`}
        </Badge>
      </div>
      {ledger.isPending && <QueryPending label="payments" />}
      {ledger.error && <QueryError error={ledger.error} onRetry={() => void ledger.refetch()} />}
      {ledger.data && (
        <Table.Table>
          <Table.TableHeader>
            <Table.TableRow>
              {COLUMNS.map((column) => (
                <Table.TableHead key={column}>{column}</Table.TableHead>
              ))}
            </Table.TableRow>
          </Table.TableHeader>
          <Table.TableBody>
            {ledger.data.rows.map((row) => {
              const hcsUrl = row.hcsSequence === null ? null : hcsMessageUrl(hcs, row.hcsSequence);
              return (
                <Table.TableRow
                  key={row.paymentId}
                  data-testid={TEST_IDS.paymentRow(row.paymentId)}
                >
                  <Table.TableCell className="tabular-nums">
                    {formatConsensusTime(row.consensusAt)}
                  </Table.TableCell>
                  <Table.TableCell>
                    {row.agentLabel}
                    {row.sample && (
                      <Badge variant="outline" className="ml-2">
                        sample
                      </Badge>
                    )}
                  </Table.TableCell>
                  <Table.TableCell className="tabular-nums">
                    {formatUsdc(amountToBigint(row.priceMicro))}
                  </Table.TableCell>
                  <Table.TableCell className="tabular-nums">
                    {formatUsdc(amountToBigint(row.tdsMicro))}
                  </Table.TableCell>
                  <Table.TableCell>{reserveLabel(row.rateBps)}</Table.TableCell>
                  <Table.TableCell>
                    {REASON_LABELS[row.reason]}
                    {row.flags.includes('fema_review') && (
                      <Badge variant="outline" className="ml-2">
                        FEMA review
                      </Badge>
                    )}
                  </Table.TableCell>
                  <Table.TableCell className="flex gap-3">
                    <a
                      href={row.hashscanUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-4"
                    >
                      HashScan
                    </a>
                    {hcsUrl && (
                      <a
                        href={hcsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-4"
                      >
                        HCS #{row.hcsSequence}
                      </a>
                    )}
                  </Table.TableCell>
                </Table.TableRow>
              );
            })}
          </Table.TableBody>
        </Table.Table>
      )}
    </section>
  );
};
