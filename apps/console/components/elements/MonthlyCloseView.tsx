'use client';

import { ChallanPanel } from '@/components/elements/ChallanPanel';
import { QueryError, QueryPending } from '@/components/elements/QueryStatus';
import * as Card from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import * as Table from '@/components/ui/table';
import { currentMonth, type Month, monthLabel, recentMonths } from '@/lib/monthly';
import { getCloseQueryParams } from '@/lib/queries';
import { TEST_IDS } from '@/lib/test-ids';
import { formatInr, formatUsdc } from '@kosha/shared/money';
import { type MonthlyClose, monthSchema } from '@kosha/shared/tax-reports';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

const MONTHS_SHOWN = 6;

// What the deductor pays on the income-tax portal for the month: TDS per payer, section 393(1)
const PaymentSummary = ({ close }: { close: MonthlyClose }) => (
  <Card.Card>
    <Card.CardHeader>
      <Card.CardDescription>
        Deductor {close.deductorRef} · section {close.section}
      </Card.CardDescription>
      <Card.CardTitle className="text-xl tabular-nums">
        {formatInr(BigInt(close.totalTdsPaise))} TDS to deposit
      </Card.CardTitle>
    </Card.CardHeader>
    <Card.CardContent>
      {close.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No TDS was withheld in {monthLabel(close.month)}.
        </p>
      ) : (
        <Table.Table>
          <Table.TableHeader>
            <Table.TableRow>
              <Table.TableHead>Payer</Table.TableHead>
              <Table.TableHead>Deductee</Table.TableHead>
              <Table.TableHead className="text-right">TDS</Table.TableHead>
              <Table.TableHead className="text-right">Held in reserve (USDC)</Table.TableHead>
            </Table.TableRow>
          </Table.TableHeader>
          <Table.TableBody>
            {close.rows.map((row) => (
              <Table.TableRow key={row.agentId} data-testid={TEST_IDS.closeRow(row.agentId)}>
                <Table.TableCell className="font-mono">{row.agentId}</Table.TableCell>
                <Table.TableCell className="font-mono">{row.deducteeRef}</Table.TableCell>
                <Table.TableCell className="text-right tabular-nums">
                  {formatInr(BigInt(row.tdsPaise))}
                </Table.TableCell>
                <Table.TableCell className="text-right tabular-nums">
                  {formatUsdc(BigInt(row.tdsMicro))} in {row.reserveAccountId}
                </Table.TableCell>
              </Table.TableRow>
            ))}
          </Table.TableBody>
        </Table.Table>
      )}
    </Card.CardContent>
  </Card.Card>
);

// The API owner's monthly close: the month's TDS, the challan, then the reserve releases
export const MonthlyCloseView = () => {
  // The month follows the viewer's clock, so it is read after mount, never while prerendering
  const [months, setMonths] = useState<Month[]>([]);
  const [picked, setPicked] = useState<Month | null>(null);
  useEffect(() => {
    const now = new Date();
    setMonths(recentMonths(now, MONTHS_SHOWN));
    setPicked(currentMonth(now));
  }, []);
  const close = useQuery({ ...getCloseQueryParams(picked ?? ''), enabled: picked !== null });

  if (!picked) return <QueryPending label="the monthly close" />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="month">Month</Label>
        <NativeSelect
          id="month"
          value={picked}
          onChange={(event) => {
            const month = monthSchema.safeParse(event.target.value);
            if (month.success) setPicked(month.data);
          }}
          data-testid={TEST_IDS.monthPicker}
        >
          {months.map((option) => (
            <NativeSelectOption key={option} value={option}>
              {monthLabel(option)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      {close.isPending ? <QueryPending label="the monthly close" /> : null}
      {close.error ? <QueryError error={close.error} onRetry={() => void close.refetch()} /> : null}
      {close.data ? (
        <>
          <PaymentSummary close={close.data} />
          <ChallanPanel month={picked} hasTds={BigInt(close.data.totalTdsPaise) > 0n} />
        </>
      ) : null}
    </div>
  );
};
