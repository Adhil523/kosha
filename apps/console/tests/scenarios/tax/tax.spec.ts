import { setupWorkspaceTestSuite } from '../../lib/helpers';
import { ROUTES } from '@/lib/routes';
import { TEST_IDS } from '@/lib/test-ids';
import { expect, type Page, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// A15's columns, in order: the file a CA prepares the TDS statement from
const TDS_HEADER =
  'deducteeRef,considerationPaise,tdsPaise,rateBps,fundedBy,paymentDate,deductionDate,section,hcsSequence,transactionId';

const downloadTdsFile = async ({ page }: { page: Page }) => {
  const button = page.getByTestId(TEST_IDS.tdsDownload);
  await expect(button).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const path = await download.path();
  return {
    name: download.suggestedFilename(),
    lines: (await readFile(path, 'utf8')).split('\r\n')
  };
};

test.describe('TDS download for the API owner', () => {
  setupWorkspaceTestSuite({ role: 'owner', href: ROUTES.owner.tax });

  test('should download the quarter TDS file with the statement header row', async ({ page }) => {
    await expect(page.getByTestId(TEST_IDS.taxStat('tds'))).toBeVisible();

    const file = await downloadTdsFile({ page });

    expect(file.name).toMatch(/^kosha-tds-\d{4}-Q[1-4]\.csv$/);
    expect(file.lines[0]).toBe(TDS_HEADER);
    expect(file.lines[1]).toContain(',deductee_reserve,');
  });
});

test.describe('Filing view for the CA', () => {
  setupWorkspaceTestSuite({ role: 'ca', href: ROUTES.ca.filing });

  test('should show each statement row with its evidence and download the same file', async ({
    page
  }) => {
    const row = page.getByTestId(new RegExp(`^${TEST_IDS.evidenceRow('')}`)).first();
    await expect(row).toBeVisible();
    await expect(row.getByRole('link', { name: 'HashScan' })).toBeVisible();

    const file = await downloadTdsFile({ page });

    expect(file.lines[0]).toBe(TDS_HEADER);
  });
});
