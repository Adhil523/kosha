'use client';

import { cn } from '@/lib/utils';
import { type ReactNode, useState } from 'react';

type LoopProps = {
  /** Named in the pause button's label */
  label: string;
  className?: string;
  children: ReactNode;
};

/**
 * Hosts one repeating CSS loop: the pointer entering restarts it from the top, and the disc in
 * the corner pauses it (motion.md). Phones and reduced motion hold the finished frame via CSS.
 */
export const Loop = ({ label, className, children }: LoopProps) => {
  const [run, setRun] = useState(0);
  const [paused, setPaused] = useState(false);

  return (
    <div
      className={cn('loop-host relative', className)}
      data-paused={paused ? '' : undefined}
      onPointerEnter={() => {
        if (!paused) setRun((value) => value + 1);
      }}
    >
      <div key={run} className="contents">
        {children}
      </div>
      <button
        type="button"
        aria-label={paused ? `Play ${label}` : `Pause ${label}`}
        onClick={() => setPaused((value) => !value)}
        className="absolute right-3 bottom-3 hidden size-8 items-center justify-center rounded-full bg-ink text-ground transition-opacity duration-(--m-out) sm:flex"
      >
        {paused ? (
          <svg viewBox="0 0 12 12" className="size-3 fill-current" aria-hidden="true">
            <path d="M3 1.5v9l7-4.5z" />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" className="size-3 fill-current" aria-hidden="true">
            <path d="M2.5 1.5h2.5v9h-2.5zM7 1.5h2.5v9h-2.5z" />
          </svg>
        )}
      </button>
    </div>
  );
};
