import { cn } from '@/lib/utils';

type Tone = 'accent' | 'warning' | 'plain';
type PaymentRow = { agent: string; tds: string; reason: string; tone: Tone };

// Amounts and reasons match the seeded Console: 0.10 USDC at ₹88.4, 1% past ₹10,000 a year,
// 20% for a payer with no PAN past the owner's tolerance. Enough rows that the frame cuts the list.
const ROW_DATA: [string, string, string, Tone][] = [
  ['agent-resident', '0.001019', '1% reserved', 'accent'],
  ['agent-resident', '0', 'under threshold', 'plain'],
  ['agent-unknown', '0.010000', '20%, no PAN', 'warning'],
  ['agent-nonresident', '0', 'non-resident', 'plain'],
  ['agent-resident', '0', 'under threshold', 'plain'],
  ['agent-unknown', '0', 'within tolerance', 'plain'],
  ['agent-resident', '0', 'under threshold', 'plain'],
  ['agent-resident', '0', 'under threshold', 'plain'],
  ['agent-unknown', '0', 'within tolerance', 'plain'],
  ['agent-resident', '0', 'under threshold', 'plain'],
  ['agent-nonresident', '0', 'non-resident', 'plain'],
  ['agent-resident', '0', 'under threshold', 'plain'],
  ['agent-unknown', '0', 'within tolerance', 'plain'],
  ['agent-resident', '0', 'under threshold', 'plain'],
  ['agent-resident', '0', 'under threshold', 'plain'],
  ['agent-unknown', '0', 'within tolerance', 'plain'],
  ['agent-resident', '0', 'under threshold', 'plain'],
  ['agent-resident', '0', 'under threshold', 'plain']
];
const ROWS: PaymentRow[] = ROW_DATA.map(([agent, tds, reason, tone]) => ({
  agent,
  tds,
  reason,
  tone
}));

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
    <div className="grid sm:grid-cols-[124px_minmax(0,1fr)]">
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
      {/* The right padding keeps the content clear of the frame's cut at the window's right */}
      <div className="flex min-w-0 flex-col gap-4 p-4 sm:pr-16">
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
              <div className="flex justify-between gap-3 text-ui-meta">
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
              <th className="py-1.5 pr-3 font-normal">agent</th>
              <th className="py-1.5 pr-3 text-right font-normal">tds</th>
              <th className="py-1.5 font-normal">reason</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, index) => (
              <tr key={index} className="border-t border-line">
                <td className="py-2 pr-3 whitespace-nowrap">{row.agent}</td>
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
