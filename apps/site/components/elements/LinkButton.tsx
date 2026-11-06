import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

type LinkButtonProps = {
  href: string;
  variant?: 'primary' | 'secondary';
  size?: 'default' | 'xl';
  className?: string;
  children: ReactNode;
};

const isExternal = (href: string) => href.startsWith('http');

/** The one arrow style on the page: on the main action only, it moves 3px under the pointer */
const Arrow = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className={cn('m-arrow size-4', className)}>
    <path
      d="M3 8h10M9 4l4 4-4 4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const LinkButton = ({
  href,
  variant = 'primary',
  size = 'default',
  className,
  children
}: LinkButtonProps) => (
  <a
    href={href}
    className={cn(
      'btn',
      variant === 'primary' ? 'btn-primary' : 'btn-secondary',
      size === 'xl' && 'btn-xl',
      className
    )}
    {...(isExternal(href) ? { target: '_blank', rel: 'noreferrer' } : {})}
  >
    {children}
    {variant === 'primary' ? <Arrow className={size === 'xl' ? 'size-7' : undefined} /> : null}
  </a>
);
