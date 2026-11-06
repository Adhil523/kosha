'use client';

import { payerLabels } from '@/lib/payer-labels';
import { getLedgerQueryParams } from '@/lib/queries';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

// A payer's readable label from the cached ledger, or its ID when no recent payment names it
export const usePayerLabel = (): ((agentId: string) => string) => {
  const ledger = useQuery(getLedgerQueryParams());
  const labels = useMemo(() => payerLabels(ledger.data?.rows), [ledger.data]);
  return (agentId) => labels.get(agentId) ?? agentId;
};
