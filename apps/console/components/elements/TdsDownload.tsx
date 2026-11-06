import { buttonVariants } from '@/components/ui/button';
import { TEST_IDS } from '@/lib/test-ids';
import { URLS } from '@/lib/urls';
import { Download } from 'lucide-react';

// A plain link: the browser saves Core's CSV as it streams through the route handler
export const TdsDownload = ({ quarter }: { quarter: string }) => (
  <a
    href={URLS.console.tdsExport(quarter)}
    download={`kosha-tds-${quarter}.csv`}
    className={buttonVariants({ variant: 'outline' })}
    data-testid={TEST_IDS.tdsDownload}
  >
    <Download className="size-4" aria-hidden />
    Download TDS file
  </a>
);
