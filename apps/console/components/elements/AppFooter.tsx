import { Badge } from '@/components/ui/badge';
import { TEST_IDS } from '@/lib/test-ids';

// Shown on every screen, so nobody mistakes the demo for filed, reviewed tax data.
const FOOTER_LABELS = ['Sample data', 'Rule pack unreviewed', 'Not tax advice'] as const;

export const AppFooter = () => (
  <footer
    data-testid={TEST_IDS.footerLabels}
    className="flex flex-wrap items-center gap-2 border-t px-6 py-3"
  >
    {FOOTER_LABELS.map((label) => (
      <Badge key={label} variant="outline">
        {label}
      </Badge>
    ))}
  </footer>
);
