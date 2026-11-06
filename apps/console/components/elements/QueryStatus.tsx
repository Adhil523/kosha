'use client';

import { Button } from '@/components/ui/button';
import { TEST_IDS } from '@/lib/test-ids';
import { LoaderCircle } from 'lucide-react';

// The one pending state for every query
export const QueryPending = ({ label }: { label: string }) => (
  <p className="flex items-center gap-2 text-sm text-muted-foreground">
    <LoaderCircle className="size-4 animate-spin" aria-hidden />
    Loading {label}…
  </p>
);

// The one error state for every query: the message and a retry
export const QueryError = ({ error, onRetry }: { error: Error; onRetry: () => void }) => (
  <div className="flex items-center gap-3 text-sm text-destructive">
    <span>{error.message}</span>
    <Button variant="outline" size="sm" onClick={onRetry} data-testid={TEST_IDS.queryRetry}>
      Retry
    </Button>
  </div>
);
