import { Badge } from '@/components/ui/badge';
import { getActiveRulePack } from '@/lib/core.server';
import { TEST_IDS } from '@/lib/test-ids';

// "in-2026.2 · unreviewed": the law is configurable, and nobody has signed this pack off yet.
export const RulePackBadge = async () => {
  const pack = await getActiveRulePack();
  const title =
    pack.source === 'core' ? 'Active rule pack, from Kosha Core' : 'Core unreachable: default pack';

  return (
    <Badge
      variant={pack.reviewed ? 'secondary' : 'outline'}
      title={title}
      data-testid={TEST_IDS.rulePackBadge}
    >
      {pack.id} · {pack.reviewed ? 'reviewed' : 'unreviewed'}
    </Badge>
  );
};
