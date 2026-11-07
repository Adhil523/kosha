import { LiveOverview } from '@/components/elements/LiveOverview';
import { demoFxInrPerUsd } from '@/lib/display-config.server';
import { ROUTES } from '@/lib/routes';
import { TEST_IDS } from '@/lib/test-ids';
import { findNavItem } from '@/lib/workspaces';

const OverviewPage = () => (
  <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-1">
      <h1 data-testid={TEST_IDS.pageTitle} className="text-2xl font-semibold tracking-tight">
        {findNavItem(ROUTES.owner.overview)?.label}
      </h1>
      <p className="text-sm text-muted-foreground">
        What your API earned, and the TDS each payer reserved, as payments settle on Hedera.
      </p>
    </div>
    <LiveOverview fxInrPerUsd={demoFxInrPerUsd()} />
  </div>
);

export default OverviewPage;
