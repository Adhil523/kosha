import { MonthlyCloseView } from '@/components/elements/MonthlyCloseView';
import { ROUTES } from '@/lib/routes';
import { TEST_IDS } from '@/lib/test-ids';
import { findNavItem } from '@/lib/workspaces';

const MonthlyPage = () => (
  <div className="flex flex-col gap-6">
    <h1 data-testid={TEST_IDS.pageTitle} className="text-2xl font-semibold tracking-tight">
      {findNavItem(ROUTES.owner.monthly)?.label}
    </h1>
    <MonthlyCloseView />
  </div>
);

export default MonthlyPage;
