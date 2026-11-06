'use client';

import { QueryError, QueryPending } from '@/components/elements/QueryStatus';
import { RulePackEvidence } from '@/components/elements/RulePackEvidence';
import { TdsDownload } from '@/components/elements/TdsDownload';
import * as Card from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import * as Table from '@/components/ui/table';
import { reserveLabel } from '@/lib/payment-format';
import { getTaxReportQueryParams } from '@/lib/queries';
import { currentQuarter, type Quarter, recentQuarters, type TaxReport } from '@/lib/tax-report';
import { TEST_IDS } from '@/lib/test-ids';
import { hashscanTransaction, mirrorTopicMessage } from '@kosha/shared/links';
import { formatInr } from '@kosha/shared/money';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

const QUARTERS_SHOWN = 4;

const inr = (paise: string): string => formatInr(BigInt(paise));

const Stat = ({ id, label, value }: { id: string; label: string; value: string }) => (
  <Card.Card data-testid={TEST_IDS.taxStat(id)}>
    <Card.CardHeader>
      <Card.CardDescription>{label}</Card.CardDescription>
      <Card.CardTitle className="text-xl tabular-nums">{value}</Card.CardTitle>
    </Card.CardHeader>
  </Card.Card>
);

// The API owner's view: what to deposit, and from whom it was deducted
const OwnerSummary = ({ report }: { report: TaxReport }) => (
  <Card.Card>
    <Card.CardHeader>
      <Card.CardTitle className="text-base">Deductee-wise totals</Card.CardTitle>
      <Card.CardDescription>
        Each payer funded its own TDS into its 2-of-2 reserve; you received the full price.
      </Card.CardDescription>
    </Card.CardHeader>
    <Card.CardContent>
      <Table.Table>
        <Table.TableHeader>
          <Table.TableRow>
            <Table.TableHead>Deductee</Table.TableHead>
            <Table.TableHead className="text-right">Payments</Table.TableHead>
            <Table.TableHead className="text-right">Consideration</Table.TableHead>
            <Table.TableHead className="text-right">TDS</Table.TableHead>
            <Table.TableHead>Rate</Table.TableHead>
          </Table.TableRow>
        </Table.TableHeader>
        <Table.TableBody>
          {report.deductees.map((line) => (
            <Table.TableRow
              key={line.deducteeRef}
              data-testid={TEST_IDS.deducteeRow(line.deducteeRef)}
            >
              <Table.TableCell className="font-mono">{line.deducteeRef}</Table.TableCell>
              <Table.TableCell className="text-right tabular-nums">{line.payments}</Table.TableCell>
              <Table.TableCell className="text-right tabular-nums">
                {inr(line.considerationPaise)}
              </Table.TableCell>
              <Table.TableCell className="text-right tabular-nums">
                {inr(line.tdsPaise)}
              </Table.TableCell>
              <Table.TableCell>
                {line.rates.map((bps) => reserveLabel(bps)).join(', ')}
              </Table.TableCell>
            </Table.TableRow>
          ))}
        </Table.TableBody>
      </Table.Table>
    </Card.CardContent>
  </Card.Card>
);

// The CA's view: every row of the statement with the on-chain evidence behind it
const FilingEvidence = ({ report }: { report: TaxReport }) => (
  <Card.Card>
    <Card.CardHeader>
      <Card.CardTitle className="text-base">Statement rows and evidence</Card.CardTitle>
      <Card.CardDescription>
        Read only. Each row links to the Hedera transaction that settled it and its HCS record.
      </Card.CardDescription>
    </Card.CardHeader>
    <Card.CardContent>
      <Table.Table>
        <Table.TableHeader>
          <Table.TableRow>
            <Table.TableHead>Date</Table.TableHead>
            <Table.TableHead>Deductee</Table.TableHead>
            <Table.TableHead className="text-right">Consideration</Table.TableHead>
            <Table.TableHead className="text-right">TDS</Table.TableHead>
            <Table.TableHead>Section</Table.TableHead>
            <Table.TableHead>Evidence</Table.TableHead>
          </Table.TableRow>
        </Table.TableHeader>
        <Table.TableBody>
          {report.rows.map((row) => (
            <Table.TableRow
              key={row.transactionId}
              data-testid={TEST_IDS.evidenceRow(row.transactionId)}
            >
              <Table.TableCell className="tabular-nums">{row.paymentDate}</Table.TableCell>
              <Table.TableCell className="font-mono">{row.deducteeRef}</Table.TableCell>
              <Table.TableCell className="text-right tabular-nums">
                {inr(row.considerationPaise)}
              </Table.TableCell>
              <Table.TableCell className="text-right tabular-nums">
                {inr(row.tdsPaise)} · {reserveLabel(row.rateBps)}
              </Table.TableCell>
              <Table.TableCell>{row.section}</Table.TableCell>
              <Table.TableCell className="flex gap-3">
                <a
                  href={hashscanTransaction('testnet', row.transactionId)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline-offset-4 hover:underline"
                >
                  HashScan
                </a>
                {report.hcsTopic && row.hcsSequence !== null ? (
                  <a
                    href={mirrorTopicMessage(
                      report.hcsTopic.mirrorUrl,
                      report.hcsTopic.topicId,
                      row.hcsSequence
                    )}
                    target="_blank"
                    rel="noreferrer"
                    className="underline-offset-4 hover:underline"
                  >
                    HCS #{row.hcsSequence}
                  </a>
                ) : null}
              </Table.TableCell>
            </Table.TableRow>
          ))}
        </Table.TableBody>
      </Table.Table>
    </Card.CardContent>
  </Card.Card>
);

// One quarter's TDS. The owner sees totals per deductee; the CA sees each row with its evidence.
// Both can download the file the statement is prepared from.
export const TaxReportView = ({ view }: { view: 'owner' | 'ca' }) => {
  // The quarter follows the viewer's clock, so it is read after mount, never while prerendering
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [picked, setPicked] = useState<Quarter | null>(null);
  useEffect(() => {
    const now = new Date();
    setQuarters(recentQuarters(now, QUARTERS_SHOWN));
    setPicked(currentQuarter(now));
  }, []);
  const report = useQuery({ ...getTaxReportQueryParams(picked ?? ''), enabled: picked !== null });

  if (!picked) return <QueryPending label="the TDS report" />;
  const quarter = picked;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quarter">Quarter (financial year, April start)</Label>
          <NativeSelect
            id="quarter"
            value={quarter}
            onChange={(event) => setPicked(event.target.value as Quarter)}
            data-testid={TEST_IDS.quarterPicker}
          >
            {quarters.map((option) => (
              <NativeSelectOption key={option} value={option}>
                {option}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <TdsDownload quarter={quarter} />
      </div>
      {report.isPending ? <QueryPending label="the TDS report" /> : null}
      {report.error ? (
        <QueryError error={report.error} onRetry={() => void report.refetch()} />
      ) : null}
      {report.data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat
              id="payments"
              label="Payments with TDS"
              value={String(report.data.totals.payments)}
            />
            <Stat
              id="consideration"
              label="Consideration"
              value={inr(report.data.totals.considerationPaise)}
            />
            <Stat
              id="tds"
              label="TDS to deposit (section 393(1))"
              value={inr(report.data.totals.tdsPaise)}
            />
          </div>
          {report.data.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No TDS was withheld in {quarter}.</p>
          ) : view === 'owner' ? (
            <OwnerSummary report={report.data} />
          ) : (
            <FilingEvidence report={report.data} />
          )}
          <RulePackEvidence rulePack={report.data.rulePack} />
        </>
      ) : null}
    </div>
  );
};
