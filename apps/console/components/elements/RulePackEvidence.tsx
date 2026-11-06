import { Badge } from '@/components/ui/badge';
import * as Card from '@/components/ui/card';
import { type TaxReport } from '@/lib/tax-report';
import { TEST_IDS } from '@/lib/test-ids';

// The rules every decision this quarter was made under, and where their hash sits on HCS, so
// anyone can check the pack wasn't swapped
export const RulePackEvidence = ({ rulePack }: { rulePack: TaxReport['rulePack'] }) => (
  <Card.Card>
    <Card.CardHeader className="flex flex-row flex-wrap items-center gap-2">
      <Card.CardTitle className="text-base">Rule pack {rulePack.id}</Card.CardTitle>
      <Badge variant={rulePack.reviewedBy ? 'secondary' : 'outline'}>
        {rulePack.reviewedBy ? `Reviewed by ${rulePack.reviewedBy}` : 'Unreviewed: not tax advice'}
      </Badge>
    </Card.CardHeader>
    <Card.CardContent className="flex flex-col gap-2 text-sm">
      <p className="text-muted-foreground">SHA-256 of the canonical pack</p>
      <code className="font-mono text-xs break-all" data-testid={TEST_IDS.rulePackHash}>
        {rulePack.hash}
      </code>
      {rulePack.hcs ? (
        <a
          href={rulePack.hcs.url}
          target="_blank"
          rel="noreferrer"
          className="underline-offset-4 hover:underline"
        >
          Published on HCS, message #{rulePack.hcs.sequence}
        </a>
      ) : (
        <p className="text-muted-foreground">HCS record not found yet</p>
      )}
    </Card.CardContent>
  </Card.Card>
);
