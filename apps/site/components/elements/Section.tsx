import type { SectionId } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { CSSProperties, ReactNode } from 'react';

type SectionProps = {
  id: SectionId;
  /** Screens the section takes at 1440x900: exactly one or two (layout-v4) */
  h?: 1 | 2;
  className?: string;
  children: ReactNode;
};

export const Section = ({ id, h = 1, className, children }: SectionProps) => (
  <section
    id={id}
    aria-labelledby={`${id}-h`}
    className={cn('section', className)}
    style={{ '--h': h } as CSSProperties}
  >
    <div className="wrap">{children}</div>
  </section>
);

type SectionHeadProps = {
  id: SectionId;
  title: ReactNode;
  /** One line to two sentences under the h2 */
  lead?: ReactNode;
};

export const SectionHead = ({ id, title, lead }: SectionHeadProps) => (
  <div className="grid gap-6 lg:grid-cols-12 lg:gap-x-6">
    <h2 id={`${id}-h`} className="text-h2 lg:col-span-6">
      {title}
    </h2>
    {lead ? <p className="text-lead text-muted lg:col-span-5 lg:col-start-8">{lead}</p> : null}
  </div>
);
