import { PaymentsFeed } from '@/components/elements/PaymentsFeed';
import { paymentsHcsConfig } from '@/lib/hcs-config.server';
import { ROUTES } from '@/lib/routes';
import { TEST_IDS } from '@/lib/test-ids';
import { findNavItem } from '@/lib/workspaces';

const PaymentsPage = () => (
  <div className="flex flex-col gap-6">
    <h1 data-testid={TEST_IDS.pageTitle} className="text-2xl font-semibold tracking-tight">
      {findNavItem(ROUTES.owner.payments)?.label}
    </h1>
    <PaymentsFeed hcs={paymentsHcsConfig()} />
  </div>
);

export default PaymentsPage;
