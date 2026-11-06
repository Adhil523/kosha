'use client';

import { QueryError, QueryPending } from '@/components/elements/QueryStatus';
import * as Card from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import * as Table from '@/components/ui/table';
import { getAgentSpendQueryParams } from '@/lib/queries';
import { type SpendSummary } from '@/lib/spend';
import { TEST_IDS } from '@/lib/test-ids';
import { formatUsdc } from '@kosha/shared/money';
import { useQuery } from '@tanstack/react-query';

const PERCENT = 100n;

const usdc = (micro: string): string => `${formatUsdc(BigInt(micro))} USDC`;

const Stat = ({ id, label, value }: { id: string; label: string; value: string }) => (
  <Card.Card data-testid={TEST_IDS.spendStat(id)}>
    <Card.CardHeader>
      <Card.CardDescription>{label}</Card.CardDescription>
      <Card.CardTitle className="text-xl tabular-nums">{value}</Card.CardTitle>
    </Card.CardHeader>
  </Card.Card>
);

// Share of the yearly budget used, 0–100
const budgetUsedPct = (budget: string, left: string): number => {
  const total = BigInt(budget);
  return total === 0n ? 100 : Number(((total - BigInt(left)) * PERCENT) / total);
};

const SpendTable = ({
  title,
  keyLabel,
  lines
}: {
  title: string;
  keyLabel: string;
  lines: SpendSummary['byApi'];
}) => (
  <Card.Card>
    <Card.CardHeader>
      <Card.CardTitle className="text-base">{title}</Card.CardTitle>
    </Card.CardHeader>
    <Card.CardContent>
      <Table.Table>
        <Table.TableHeader>
          <Table.TableRow>
            <Table.TableHead>{keyLabel}</Table.TableHead>
            <Table.TableHead className="text-right">Payments</Table.TableHead>
            <Table.TableHead className="text-right">Price</Table.TableHead>
            <Table.TableHead className="text-right">TDS on top</Table.TableHead>
          </Table.TableRow>
        </Table.TableHeader>
        <Table.TableBody>
          {lines.map((line) => (
            <Table.TableRow key={line.key}>
              <Table.TableCell className="font-mono">{line.key}</Table.TableCell>
              <Table.TableCell className="text-right tabular-nums">{line.payments}</Table.TableCell>
              <Table.TableCell className="text-right tabular-nums">
                {usdc(line.priceMicro)}
              </Table.TableCell>
              <Table.TableCell className="text-right tabular-nums">
                {usdc(line.tdsMicro)}
              </Table.TableCell>
            </Table.TableRow>
          ))}
        </Table.TableBody>
      </Table.Table>
    </Card.CardContent>
  </Card.Card>
);

// One agent's spend this financial year: price paid, TDS reserved on top, and budget left
export const SpendView = ({ agentId }: { agentId: string }) => {
  const spend = useQuery(getAgentSpendQueryParams(agentId));

  if (spend.isPending) return <QueryPending label="spend" />;
  if (spend.error) {
    return <QueryError error={spend.error} onRetry={() => void spend.refetch()} />;
  }
  const { priceMicro, tdsMicro, budgetMicro, budgetLeftMicro, byApi, byDay } = spend.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat id="price" label="Paid to APIs this year" value={usdc(priceMicro)} />
        <Stat id="tds" label="TDS reserved on top (in your reserve)" value={usdc(tdsMicro)} />
        <Stat
          id="budget-left"
          label="Yearly budget left"
          value={budgetLeftMicro === null ? 'No budget set' : usdc(budgetLeftMicro)}
        />
      </div>
      {budgetMicro !== null && budgetLeftMicro !== null ? (
        <div className="flex flex-col gap-1">
          <Progress value={budgetUsedPct(budgetMicro, budgetLeftMicro)} />
          <p className="text-xs text-muted-foreground">
            Of a {usdc(budgetMicro)} budget. Caps count the all-in total, tax included.
          </p>
        </div>
      ) : null}
      {byApi.length === 0 ? (
        <p className="text-sm text-muted-foreground">No payments this financial year yet.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <SpendTable title="By API" keyLabel="Receiver" lines={byApi} />
          <SpendTable title="By day (IST)" keyLabel="Day" lines={byDay} />
        </div>
      )}
    </div>
  );
};
