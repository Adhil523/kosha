'use client';

import { OverviewCards } from '@/components/elements/OverviewCards';
import { ThresholdCounter } from '@/components/elements/ThresholdCounter';
import { useLiveStream } from '@/lib/use-live-stream';

// The API owner's landing screen: today's numbers above the threshold counter, one live stream
export const LiveOverview = ({ fxInrPerUsd }: { fxInrPerUsd: string }) => {
  const streaming = useLiveStream();
  return (
    <div className="flex flex-col gap-6">
      <OverviewCards streaming={streaming} />
      <ThresholdCounter streaming={streaming} fxInrPerUsd={fxInrPerUsd} />
    </div>
  );
};
