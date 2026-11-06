'use client';

import { type HcsLinkConfig, PaymentsFeed } from '@/components/elements/PaymentsFeed';
import { ThresholdCounter } from '@/components/elements/ThresholdCounter';
import { useLiveStream } from '@/lib/use-live-stream';

type LiveReceiverViewProps = { hcs: HcsLinkConfig; fxInrPerUsd: string };

// The demo-critical pair: the counter above the feed, both fed by one live stream
export const LiveReceiverView = ({ hcs, fxInrPerUsd }: LiveReceiverViewProps) => {
  const streaming = useLiveStream();
  return (
    <div className="flex flex-col gap-6">
      <ThresholdCounter streaming={streaming} fxInrPerUsd={fxInrPerUsd} />
      <PaymentsFeed hcs={hcs} streaming={streaming} />
    </div>
  );
};
