import { OutsidePayments } from '@/components/elements/OutsidePayments';
import { ROUTES } from '@/lib/routes';
import { TEST_IDS } from '@/lib/test-ids';
import { findNavItem } from '@/lib/workspaces';

const OutsidePaymentsPage = () => (
  <div className="flex flex-col gap-6">
    <h1 data-testid={TEST_IDS.pageTitle} className="text-2xl font-semibold tracking-tight">
      {findNavItem(ROUTES.owner.outside)?.label}
    </h1>
    <OutsidePayments />
  </div>
);

export default OutsidePaymentsPage;
