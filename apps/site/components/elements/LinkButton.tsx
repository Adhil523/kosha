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
  </a>
);
