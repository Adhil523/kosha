import { signIn } from './actions';
import { Button } from '@/components/ui/button';
import * as Card from '@/components/ui/card';
import { TEST_IDS } from '@/lib/test-ids';
import { WORKSPACE_ORDER, WORKSPACES } from '@/lib/workspaces';

const SignInPage = () => (
  <main className="flex flex-1 items-center justify-center p-8">
    <Card.Card className="w-full max-w-md">
      <Card.CardHeader>
        <Card.CardTitle>Sign in to Kosha Console</Card.CardTitle>
        <Card.CardDescription>
          Demo sign-in: pick a workspace. There are no accounts or passwords.
        </Card.CardDescription>
      </Card.CardHeader>
      <Card.CardContent>
        <form action={signIn} className="flex flex-col gap-2">
          {WORKSPACE_ORDER.map((id) => (
            <Button
              key={id}
              type="submit"
              name="role"
              value={id}
              variant="outline"
              data-testid={TEST_IDS.signInRole(id)}
            >
              {WORKSPACES[id].label}
            </Button>
          ))}
        </form>
      </Card.CardContent>
    </Card.Card>
  </main>
);

export default SignInPage;
