import { TEST_IDS } from '@/lib/test-ids';
import { findNavItem, type WorkspaceId } from '@/lib/workspaces';
import type { AggregateRow } from '@kosha/shared/console-api';
import { expect, type Page, test } from '@playwright/test';

// The demo sign-in: pick a workspace and land inside it
export const signInAs = async ({ page, role }: { page: Page; role: WorkspaceId }) => {
  await page.goto('/sign-in');
  const choice = page.getByTestId(TEST_IDS.signInRole(role));
  await expect(choice).toBeVisible();
  await choice.click();
  await expect(page.getByTestId(TEST_IDS.sideNav)).toBeVisible();
};

export const navigateToPage = async ({ page, href }: { page: Page; href: string }) => {
  const link = page.getByTestId(TEST_IDS.navLink(href));
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(href);
  // Next.js keeps the previous page mounted but hidden, so match the visible title by its text
  const title = page.getByTestId(TEST_IDS.pageTitle).filter({ visible: true });
  await expect(title).toHaveText(findNavItem(href)?.label ?? '');
};

export const setupWorkspaceTestSuite = ({ role, href }: { role: WorkspaceId; href: string }) => {
  test.beforeEach(async ({ page }) => {
    await signInAs({ page, role });
    await navigateToPage({ page, href });
  });
};

// agent-resident against receiver-in's ₹10,000 threshold, at a given yearly total
export const generatePayerTotal = ({ valuePaise }: { valuePaise: number }): AggregateRow =>
  ({
    receiverId: 'rcv_in',
    agentId: 'agt_resident',
    agentLevel: 1,
    payerResidency: 'resident',
    fy: '2026-27',
    valuePaise: String(valuePaise),
    outsideValuePaise: '0',
    thresholdPaise: '1000000',
    tolerancePaise: null,
    pct: valuePaise / 10_000
  }) as AggregateRow;

// Serves whatever payer totals the test last set. The live stream invalidates the totals on every
// event, so after `show()` the next refetch brings the new numbers to the screen.
export const servePayerTotals = async ({
  page,
  initial
}: {
  page: Page;
  initial: AggregateRow[];
}): Promise<{ show: (rows: AggregateRow[]) => void }> => {
  let current = initial;
  await page.route('**/api/aggregates', async (route) => {
    await route.fulfill({ json: current });
  });
  return {
    show: (rows) => {
      current = rows;
    }
  };
};
