import { cn } from '@/lib/utils';

type PaymentRow = {
  time: string;
  agent: string;
  price: string;
  tds: string;
  rate: string;
  reason: string;
  tone: 'accent' | 'warning' | 'plain';
};

// Amounts and reasons match the seeded Console: 0.10 USDC at ₹88.4, 1% past ₹10,000 a year,
// 20% for a payer with no PAN past the owner's tolerance.
const ROWS: PaymentRow[] = [
  {
    time: '14:02:51',
    agent: 'agent-resident',
    price: '0.100000',
    tds: '0.001019',
    rate: '1%',
    reason: '1% reserved',
    tone: 'accent'
  },
  {
    time: '14:02:38',
    agent: 'agent-resident',
    price: '0.100000',
    tds: '0',
    rate: '0%',
    reason: 'under threshold',
    tone: 'plain'
  },
  {
    time: '14:01:10',
    agent: 'agent-unknown',
    price: '0.050000',
    tds: '0.010000',
    rate: '20%',
    reason: '20% reserved, no PAN',
    tone: 'warning'
  },
  {
    time: '13:58:04',
    agent: 'agent-nonresident',
    price: '0.250000',
    tds: '0',
    rate: '0%',
    reason: 'non-resident, flagged',
    tone: 'plain'
  },
  {
    time: '13:55:47',
    agent: 'agent-resident',
    price: '0.250000',
    tds: '0',
    rate: '0%',
    reason: 'under threshold',
    tone: 'plain'
  },
  {
    time: '13:51:22',
    agent: 'agent-unknown',
    price: '0.050000',
    tds: '0',
    rate: '0%',
    reason: 'within tolerance',
    tone: 'plain'
  },
  {
    time: '13:49:09',
    agent: 'agent-resident',
    price: '0.100000',
    tds: '0',
    rate: '0%',
    reason: 'under threshold',
    tone: 'plain'
  },
  {
    time: '13:44:31',
    agent: 'agent-resident',
    price: '0.100000',
    tds: '0',
    rate: '0%',
    reason: 'under threshold',
    tone: 'plain'
  },
  {
    time: '13:40:15',
    agent: 'agent-unknown',
    price: '0.050000',
    tds: '0',
    rate: '0%',
    reason: 'within tolerance',
    tone: 'plain'
  },
  {
    time: '13:37:58',
    agent: 'agent-resident',
    price: '0.250000',
    tds: '0',
    rate: '0%',
    reason: 'under threshold',
    tone: 'plain'
  }
];

const SIDEBAR = ['Overview', 'Payments', 'Counterparties', 'Tax', 'Monthly'];

const COUNTERS = [
  {
    payer: 'agent-resident',
    total: '₹10,113',
    share: 100,
    state: 'crossed · 1% reserved',
    tone: 'accent'
  },
  {
    payer: 'agent-unknown',
    total: '₹4,710',
    share: 94,
    state: 'of the ₹5,000 tolerance',
    tone: 'warning'
  }
] as const;

type ConsoleWindowProps = {
  className?: string;
};

/** The Console's payments screen as live HTML: the feed and the threshold counter (U01, B10) */
export const ConsoleWindow = ({ className }: ConsoleWindowProps) => (
  <div className={cn('ui overflow-hidden', className)} aria-hidden="true">
    <div className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-ui-meta text-muted">
      <span className="flex gap-1.5">
        <i className="size-2.5 rounded-full bg-line-strong" />
        <i className="size-2.5 rounded-full bg-line-strong" />
        <i className="size-2.5 rounded-full bg-line-strong" />
      </span>
      Kosha Console · receiver-in · Payments
    </div>
    <div className="grid sm:grid-cols-[132px_minmax(0,1fr)]">
      <div className="hidden flex-col gap-0.5 border-r border-line p-3 sm:flex">
        {SIDEBAR.map((item) => (
          <span
            key={item}
            className={cn(
              'rounded-sm px-2 py-1.5 text-ui',
              item === 'Payments' ? 'bg-ink/8 text-ink' : 'text-muted'
            )}
          >
            {item}
          </span>
        ))}
      </div>
      <div className="flex min-w-0 flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <span className="text-base font-medium">Payments</span>
          <span className="flex items-center gap-2 text-ui-meta text-muted">
            <i className="size-1.5 rounded-full bg-accent" />
            live
          </span>
        </div>
        <div className="flex flex-col gap-2.5">
          {COUNTERS.map((counter) => (
            <div key={counter.payer} className="flex flex-col gap-1.5">
              <div className="flex justify-between text-ui-meta">
                <span className="font-mono">{counter.payer}</span>
                <span className="text-muted">
                  <span className="text-ink">{counter.total}</span> {counter.state}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-sm bg-ink/10">
                <div
                  className={cn('h-full', counter.tone === 'accent' ? 'bg-accent' : 'bg-warning')}
                  style={{ width: `${counter.share}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        <table className="w-full border-collapse font-mono text-ui-meta">
          <thead className="text-muted">
            <tr className="text-left">
              <th className="py-1.5 pr-3 font-normal">time</th>
              <th className="py-1.5 pr-3 font-normal">agent</th>
              <th className="py-1.5 pr-3 text-right font-normal">price</th>
              <th className="py-1.5 pr-3 text-right font-normal">tds</th>
              <th className="py-1.5 font-normal">reason</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.time} className="border-t border-line">
                <td className="py-2 pr-3 text-muted">{row.time}</td>
                <td className="py-2 pr-3">{row.agent}</td>
                <td className="py-2 pr-3 text-right">{row.price}</td>
                <td
                  className={cn(
                    'py-2 pr-3 text-right',
                    row.tone === 'accent' && 'text-accent',
                    row.tone === 'warning' && 'text-warning'
                  )}
                >
                  {row.tds}
                </td>
                <td className="py-2 whitespace-nowrap">{row.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  </div>
);
