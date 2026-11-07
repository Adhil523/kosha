'use client';

import { OverviewCards } from '@/components/elements/OverviewCards';
import { RecentPayments } from '@/components/elements/RecentPayments';
import { ThresholdCounter } from '@/components/elements/ThresholdCounter';
import { useLiveStream } from '@/lib/use-live-stream';

// The API owner's landing screen: today's numbers above the threshold counter and the latest
// payments, side by side on wide screens, all fed by one live stream
export const LiveOverview = ({ fxInrPerUsd }: { fxInrPerUsd: string }) => {
  const streaming = useLiveStream();
  return (
    <div className="flex flex-col gap-4">
      <OverviewCards streaming={streaming} />
      <div className="grid gap-4 lg:grid-cols-7">
        <div className="lg:col-span-4">
          <ThresholdCounter streaming={streaming} fxInrPerUsd={fxInrPerUsd} />
        </div>
        <div className="lg:col-span-3">
          <RecentPayments streaming={streaming} />
        </div>
      </div>
    </div>
  );
};
