import { cn } from '@/lib/utils';

type MarkProps = {
  className?: string;
};

/** Kosha's mark: one amount split into two legs, the small one set aside */
export const Mark = ({ className }: MarkProps) => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    className={cn('size-6 shrink-0 text-accent', className)}
  >
    <rect x="2" y="4" width="14" height="16" rx="1.5" fill="currentColor" />
    <rect x="18" y="4" width="4" height="16" rx="1" fill="currentColor" opacity="0.55" />
  </svg>
);
