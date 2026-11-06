'use client';

import { prependLedgerRow } from '@/lib/ledger-cache';
import { QUERY_KEYS } from '@/lib/query-client';
import { URLS } from '@/lib/urls';
import { type LedgerPage, streamEventSchema } from '@kosha/shared/console-api';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

// Polling interval while the stream is down (spec: fall back to polling every 3 seconds)
export const POLL_FALLBACK_MS = 3_000;

// Subscribes to /api/stream and writes each event into the query cache. Returns whether the
// stream is connected, so queries poll only while it isn't. EventSource reconnects by itself.
export const useLiveStream = (): boolean => {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource(URLS.console.stream);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (message: MessageEvent<string>) => {
      let body: unknown;
      try {
        body = JSON.parse(message.data);
      } catch {
        return;
      }
      const parsed = streamEventSchema.safeParse(body);
      if (!parsed.success) return;
      const event = parsed.data;
      if (event.type === 'payment.settled') {
        queryClient.setQueryData<LedgerPage>(QUERY_KEYS.ledger, (page) =>
          prependLedgerRow(page, event.row)
        );
      }
      if (event.type === 'outside.payment') {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.outsidePayments });
      }
      // Every event can move a payer's yearly total and the overview; refetch both
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.aggregates });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.overview });
    };
    return () => source.close();
  }, [queryClient]);

  return connected;
};
