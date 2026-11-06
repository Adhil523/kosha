import { LiveReceiverView } from '@/components/elements/LiveReceiverView';
import { demoFxInrPerUsd, paymentsHcsConfig } from '@/lib/display-config.server';
import { ROUTES } from '@/lib/routes';
import { TEST_IDS } from '@/lib/test-ids';
import { findNavItem } from '@/lib/workspaces';

const PaymentsPage = () => (
  <div className="flex flex-col gap-6">
    <h1 data-testid={TEST_IDS.pageTitle} className="text-2xl font-semibold tracking-tight">
      {findNavItem(ROUTES.owner.payments)?.label}
    </h1>
    <LiveReceiverView hcs={paymentsHcsConfig()} fxInrPerUsd={demoFxInrPerUsd()} />
  </div>
);

export default PaymentsPage;
