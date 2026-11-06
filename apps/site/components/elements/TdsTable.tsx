import { cn } from '@/lib/utils';

// The columns of Core's quarterly TDS export (A15): one row per deductee and transaction
const HEAD = ['Deductee', 'Section', 'Paid on', 'Amount ₹', 'TDS ₹', 'Transaction'];

const ROWS = [
  ['agent-resident', '393(1)', '06-11-2026', '8.84', '0.09', '0.0.11341449@1793987971'],
  ['agent-resident', '393(1)', '06-11-2026', '22.10', '0.23', '0.0.11341449@1793986702'],
  ['agent-unknown', '393(1)', '05-11-2026', '4.42', '0.89', '0.0.11341449@1793901288'],
  ['agent-resident', '393(1)', '05-11-2026', '8.84', '0.09', '0.0.11341449@1793899143'],
  ['agent-unknown', '393(1)', '04-11-2026', '4.42', '0.89', '0.0.11341449@1793812530'],
  ['agent-resident', '393(1)', '04-11-2026', '22.10', '0.23', '0.0.11341449@1793810071'],
  ['agent-resident', '393(1)', '03-11-2026', '8.84', '0.09', '0.0.11341449@1793724416']
];

type TdsTableProps = {
  className?: string;
};

/** The Console's Tax screen: the quarter's TDS file, as the CA downloads it */
export const TdsTable = ({ className }: TdsTableProps) => (
  <div className={cn('ui overflow-hidden', className)} aria-hidden="true">
    <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-ui-meta">
      <span className="text-muted">Tax · Q3 FY 2026-27 · rule pack in-2026.2 · unreviewed</span>
      <span className="rounded-sm bg-ink px-2 py-1 font-medium text-ground">Download TDS file</span>
    </div>
    <table className="w-full border-collapse font-mono text-ui-meta">
      <thead className="text-muted">
        <tr className="text-left">
          {HEAD.map((cell) => (
            <th key={cell} className="px-4 py-2 font-normal whitespace-nowrap">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ROWS.map((row) => (
          <tr key={row.join()} className="border-t border-line">
            {row.map((cell, index) => (
              <td
                key={index}
                className={cn('px-4 py-2 whitespace-nowrap', index === 4 && 'text-accent')}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
