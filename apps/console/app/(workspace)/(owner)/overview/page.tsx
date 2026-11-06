import { LiveOverview } from '@/components/elements/LiveOverview';
import { demoFxInrPerUsd } from '@/lib/display-config.server';
import { ROUTES } from '@/lib/routes';
import { TEST_IDS } from '@/lib/test-ids';
import { findNavItem } from '@/lib/workspaces';

const OverviewPage = () => (
  <div className="flex flex-col gap-6">
    <h1 data-testid={TEST_IDS.pageTitle} className="text-2xl font-semibold tracking-tight">
      {findNavItem(ROUTES.owner.overview)?.label}
    </h1>
    <LiveOverview fxInrPerUsd={demoFxInrPerUsd()} />
  </div>
);

export default OverviewPage;
