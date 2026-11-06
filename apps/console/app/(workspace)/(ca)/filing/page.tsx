import { TaxReportView } from '@/components/elements/TaxReportView';
import { ROUTES } from '@/lib/routes';
import { TEST_IDS } from '@/lib/test-ids';
import { findNavItem } from '@/lib/workspaces';

const FilingPage = () => (
  <div className="flex flex-col gap-6">
    <h1 data-testid={TEST_IDS.pageTitle} className="text-2xl font-semibold tracking-tight">
      {findNavItem(ROUTES.ca.filing)?.label}
    </h1>
    <TaxReportView view="ca" />
  </div>
);

export default FilingPage;
