'use client';

import { QueryError, QueryPending } from '@/components/elements/QueryStatus';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import * as Card from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import * as Table from '@/components/ui/table';
import { api } from '@/lib/api';
import { CLASSIFICATION_LABELS, outsideSummary } from '@/lib/outside';
import { formatConsensusTime } from '@/lib/payment-format';
import { getOutsidePaymentsQueryParams } from '@/lib/queries';
import { QUERY_KEYS } from '@/lib/query-client';
import { TEST_IDS } from '@/lib/test-ids';
import { URLS } from '@/lib/urls';
import { POLL_FALLBACK_MS, useLiveStream } from '@/lib/use-live-stream';
import { type OutsidePaymentRow } from '@kosha/shared/console-api';
import { hashscanTransaction } from '@kosha/shared/links';
import { formatInr } from '@kosha/shared/money';
import { type OutsideClassify } from '@kosha/shared/tax-reports';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

const COLUMNS = ['Seen (IST)', 'From wallet', 'Value', 'TDS shortfall', 'Status', ''];

const inr = (paise: string): string => formatInr(BigInt(paise));

const classify = async (id: string, body: OutsideClassify): Promise<OutsidePaymentRow> => {
  const response = await api.post<OutsidePaymentRow>(URLS.console.outsideClassify(id), body);
  if (!response.ok) throw new Error(response.data.message || `not saved (${response.status})`);
  return response.data;
};

// A pending transfer's two answers; a gift opens a note field first, since Core logs the reason
const ClassifyActions = ({ row }: { row: OutsidePaymentRow }) => {
  const queryClient = useQueryClient();
  const [note, setNote] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: OutsideClassify) => classify(row.id, body),
    onSuccess: async (saved) => {
      toast.success(`Marked as ${CLASSIFICATION_LABELS[saved.classification].toLowerCase()}.`);
      // A gift leaves the payer's threshold count, so the counter and overview move too
      await Promise.all(
        [QUERY_KEYS.outsidePayments, QUERY_KEYS.aggregates, QUERY_KEYS.overview].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey })
        )
      );
    },
    onError: (error) => toast.error(`Not classified: ${error.message}`)
  });

  if (note === null) {
    return (
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={save.isPending}
          onClick={() => save.mutate({ classification: 'consideration' })}
          data-testid={TEST_IDS.outsideConsideration(row.id)}
        >
          Payment for the API
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setNote('')}
          data-testid={TEST_IDS.outsideGift(row.id)}
        >
          Gift from a relative
        </Button>
      </div>
    );
  }
  return (
    <form
      className="flex justify-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({ classification: 'not_consideration_gift', note: note.trim() });
      }}
    >
      <Input
        autoFocus
        aria-label="Why this is a gift"
        placeholder="Who sent it, and why"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        className="h-7 w-56"
        data-testid={TEST_IDS.outsideNote(row.id)}
      />
      <Button
        size="sm"
        type="submit"
        disabled={!note.trim() || save.isPending}
        data-testid={TEST_IDS.outsideGiftSave(row.id)}
      >
        Mark as gift
      </Button>
      <Button size="sm" variant="ghost" type="button" onClick={() => setNote(null)}>
        Cancel
      </Button>
    </form>
  );
};

const Status = ({ row }: { row: OutsidePaymentRow }) => (
  <div className="flex flex-col gap-1">
    <Badge variant={row.classification === 'pending' ? 'destructive' : 'secondary'}>
      {CLASSIFICATION_LABELS[row.classification]}
    </Badge>
    {row.note ? <span className="text-xs text-muted-foreground">{row.note}</span> : null}
  </div>
);

// USDC a declared payer sent straight to this receiver's wallet, outside Kosha (A19). Core never
// withholds on it: it counts toward the pair and records the TDS it should have carried.
export const OutsidePayments = () => {
  const streaming = useLiveStream();
  const outside = useQuery({
    ...getOutsidePaymentsQueryParams(),
    refetchInterval: streaming ? false : POLL_FALLBACK_MS
  });

  if (outside.isPending) return <QueryPending label="outside payments" />;
  if (outside.error) {
    return <QueryError error={outside.error} onRetry={() => void outside.refetch()} />;
  }
  const summary = outsideSummary(outside.data);

  return (
    <Card.Card>
      <Card.CardHeader>
        <Card.CardTitle data-testid={TEST_IDS.outsideSummary}>
          {summary.pending === 0
            ? 'Nothing to classify'
            : `${summary.pending} to classify, ${formatInr(summary.shortfallPaise)} TDS short`}
        </Card.CardTitle>
        <Card.CardDescription>
          Each one counts toward the payer&rsquo;s threshold until you classify it. A gift from a
          relative leaves the count and the TDS file; a payment for the API stays, and its shortfall
          is TDS you still owe.
        </Card.CardDescription>
      </Card.CardHeader>
      <Card.CardContent>
        {outside.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No transfer has arrived outside Kosha. Core checks your wallets every 30 seconds.
          </p>
        ) : (
          <Table.Table>
            <Table.TableHeader>
              <Table.TableRow>
                {COLUMNS.map((column) => (
                  <Table.TableHead key={column}>{column}</Table.TableHead>
                ))}
              </Table.TableRow>
            </Table.TableHeader>
            <Table.TableBody>
              {outside.data.map((row) => (
                <Table.TableRow key={row.id} data-testid={TEST_IDS.outsideRow(row.id)}>
                  <Table.TableCell className="tabular-nums">
                    {formatConsensusTime(row.seenAt)}
                  </Table.TableCell>
                  <Table.TableCell>
                    <a
                      href={hashscanTransaction('testnet', row.transactionId)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono underline-offset-4 hover:underline"
                    >
                      {row.fromWallet}
                    </a>
                  </Table.TableCell>
                  <Table.TableCell className="tabular-nums">{inr(row.valuePaise)}</Table.TableCell>
                  <Table.TableCell className="tabular-nums">
                    {inr(row.shortfallPaise)}
                  </Table.TableCell>
                  <Table.TableCell>
                    <Status row={row} />
                  </Table.TableCell>
                  <Table.TableCell>
                    {row.classification === 'pending' ? <ClassifyActions row={row} /> : null}
                  </Table.TableCell>
                </Table.TableRow>
              ))}
            </Table.TableBody>
          </Table.Table>
        )}
      </Card.CardContent>
    </Card.Card>
  );
};
