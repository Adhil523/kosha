import { cn } from '@/lib/utils';

// Core's four steps for the first settled payment (README, "First settled payment"), as its log
// prints them. The lines arrive one after another in the card's loop; the finished log is the
// base style, so phones and reduced motion show it whole.
const STEPS = [
  {
    name: 'quote',
    text: '₹8.84 takes the pair past ₹10,000: 1%, 1,019 µUSDC',
    animation: 'animate-log-1',
    accent: true
  },
  {
    name: 'verify',
    text: '0.101019 tUSDC signed by 0.0.11342842, the fee on Core',
    animation: 'animate-log-2'
  },
  {
    name: 'settle',
    text: '0.0.11341449@1793987971.680, two legs, one transfer',
    animation: 'animate-log-3'
  },
  {
    name: 'log',
    text: 'HCS 0.0.11342856 #6, rule pack in-2026.2',
    animation: 'animate-log-4'
  }
] as const;

type DecisionLogProps = {
  className?: string;
};

/** Core's log for one payment: quote, verify, settle, log, then the receipt goes back to Pay */
export const DecisionLog = ({ className }: DecisionLogProps) => (
  <div className={cn('ui overflow-hidden', className)} aria-hidden="true">
    <div className="flex items-center gap-3 border-b border-line px-4 py-2.5 font-mono text-ui-meta text-muted">
      <span className="flex gap-1.5">
        <i className="size-2.5 rounded-full bg-line-strong" />
        <i className="size-2.5 rounded-full bg-line-strong" />
        <i className="size-2.5 rounded-full bg-line-strong" />
      </span>
      kosha-core · POST /v1/settle · q_w7813xvnr9jqkt8w140p5nsd
    </div>
    <ol className="flex flex-col py-3 font-mono text-ui">
      {STEPS.map((step) => (
        <li
          key={step.name}
          className={cn(
            'flex items-baseline gap-3 border-l-2 border-transparent py-1.5 pr-4 pl-[14px]',
            step.animation,
            'accent' in step && 'border-accent bg-accent/8'
          )}
        >
          <span className="text-muted">✓</span>
          <span className="w-12 shrink-0 text-muted">{step.name}</span>
          <span className="whitespace-nowrap">{step.text}</span>
        </li>
      ))}
    </ol>
    <div className="animate-log-4 flex items-center gap-2 border-t border-line px-4 py-2.5 font-mono text-ui-meta text-muted">
      <i className="size-1.5 rounded-full bg-accent" />
      settled · receipt returned to Kosha Pay
    </div>
  </div>
);
