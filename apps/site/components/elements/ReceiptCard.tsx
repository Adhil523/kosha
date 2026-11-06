import { cn } from '@/lib/utils';

type ReceiptCardProps = {
  className?: string;
};

// The receipt Kosha Pay reads back from PAYMENT-RESPONSE, for the first settled payment
const STEPS = [
  { text: '0.100000 tUSDC to the API, its full price', animation: 'animate-step-1' },
  { text: '0.001019 tUSDC to the agent’s own reserve', animation: 'animate-step-2' },
  { text: 'HCS message #6, rule pack in-2026.2', animation: 'animate-step-3' }
] as const;

/** The small result card over the hero window: the three lines of a settled split payment */
export const ReceiptCard = ({ className }: ReceiptCardProps) => (
  <div className={cn('ui w-[300px] p-4 text-ui', className)} aria-hidden="true">
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium">Payment settled</span>
      <span className="animate-step-3 rounded-sm bg-accent px-1.5 py-0.5 text-ui-meta font-medium text-accent-ink">
        On Hedera
      </span>
    </div>
    <ul className="mt-3 flex flex-col gap-2">
      {STEPS.map((step) => (
        <li key={step.text} className={cn('flex items-start gap-2', step.animation)}>
          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-ink/10 text-[10px] text-accent">
            ✓
          </span>
          <span>{step.text}</span>
        </li>
      ))}
    </ul>
  </div>
);
