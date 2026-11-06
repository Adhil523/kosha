import * as Card from '@/components/ui/card';
import { TEST_IDS } from '@/lib/test-ids';
import { findNavItem } from '@/lib/workspaces';

type PagePlaceholderProps = { href: string };

// An empty screen: its title and what it will show, taken from the workspace nav.
export const PagePlaceholder = ({ href }: PagePlaceholderProps) => {
  const item = findNavItem(href);

  return (
    <div className="flex flex-col gap-4">
      <h1 data-testid={TEST_IDS.pageTitle} className="text-2xl font-semibold tracking-tight">
        {item?.label ?? href}
      </h1>
      <Card.Card>
        <Card.CardHeader>
          <Card.CardTitle>Not built yet</Card.CardTitle>
          <Card.CardDescription>{item?.description}</Card.CardDescription>
        </Card.CardHeader>
      </Card.Card>
    </div>
  );
};
