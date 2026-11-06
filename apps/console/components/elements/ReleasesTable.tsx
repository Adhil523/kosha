import { Badge } from '@/components/ui/badge';
import * as Table from '@/components/ui/table';
import { RELEASE_STATUS_LABELS } from '@/lib/monthly';
import { TEST_IDS } from '@/lib/test-ids';
import { URLS } from '@/lib/urls';
import { hashscanSchedule } from '@kosha/shared/links';
import { formatUsdc } from '@kosha/shared/money';
import { type ReleaseRow } from '@kosha/shared/tax-reports';
import { type ReactNode } from 'react';

type ReleasesTableProps = {
  releases: readonly ReleaseRow[];
  // The first column: the agent on the owner's screen, the challan on the agent's
  lead: { label: string; cell: (release: ReleaseRow) => ReactNode };
  // What the viewer can do with a release, if anything (the agent's co-sign)
  action?: (release: ReleaseRow) => ReactNode;
};

// One scheduled transfer per payer reserve, reserve → API owner, after the challan is recorded.
// Core signed it; it runs once the agent operator co-signs (2-of-2).
export const ReleasesTable = ({ releases, lead, action }: ReleasesTableProps) => (
  <Table.Table>
    <Table.TableHeader>
      <Table.TableRow>
        <Table.TableHead>{lead.label}</Table.TableHead>
        <Table.TableHead>From reserve</Table.TableHead>
        <Table.TableHead className="text-right">Amount (USDC)</Table.TableHead>
        <Table.TableHead>Status</Table.TableHead>
        <Table.TableHead>Schedule</Table.TableHead>
        {action ? <Table.TableHead /> : null}
      </Table.TableRow>
    </Table.TableHeader>
    <Table.TableBody>
      {releases.map((release) => (
        <Table.TableRow key={release.id} data-testid={TEST_IDS.releaseRow(release.id)}>
          <Table.TableCell className="font-mono">{lead.cell(release)}</Table.TableCell>
          <Table.TableCell>
            <a
              href={URLS.hashscan.account(release.reserveAccountId)}
              target="_blank"
              rel="noreferrer"
              className="font-mono underline-offset-4 hover:underline"
            >
              {release.reserveAccountId}
            </a>
          </Table.TableCell>
          <Table.TableCell className="text-right tabular-nums">
            {formatUsdc(BigInt(release.micro))}
          </Table.TableCell>
          <Table.TableCell>
            <div className="flex flex-col gap-1">
              <Badge variant={release.status === 'executed' ? 'secondary' : 'outline'}>
                {RELEASE_STATUS_LABELS[release.status]}
              </Badge>
              {release.cosignedBy ? (
                <span className="text-xs text-muted-foreground">
                  Co-signed by {release.cosignedBy}
                </span>
              ) : null}
            </div>
          </Table.TableCell>
          <Table.TableCell>
            {release.scheduleId ? (
              <a
                href={hashscanSchedule('testnet', release.scheduleId)}
                target="_blank"
                rel="noreferrer"
                className="font-mono underline-offset-4 hover:underline"
              >
                {release.scheduleId}
              </a>
            ) : (
              <span className="text-muted-foreground">not yet</span>
            )}
          </Table.TableCell>
          {action ? (
            <Table.TableCell className="text-right">{action(release)}</Table.TableCell>
          ) : null}
        </Table.TableRow>
      ))}
    </Table.TableBody>
  </Table.Table>
);
