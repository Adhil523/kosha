import { generatePayerTotal, navigateToPage, servePayerTotals, signInAs } from '../../lib/helpers';
import { ROUTES } from '@/lib/routes';
import { TEST_IDS } from '@/lib/test-ids';
import { expect, test } from '@playwright/test';

const AGENT = 'agt_resident';

test.describe('Threshold counter on the live payments screen', () => {
  test('should turn amber near the threshold and show 1% reserved once it is crossed', async ({
    page
  }) => {
    test.setTimeout(60_000);
    const totals = await servePayerTotals({
      page,
      initial: [generatePayerTotal({ valuePaise: 500_000 })]
    });
    await signInAs({ page, role: 'owner' });
    await navigateToPage({ page, href: ROUTES.owner.payments });

    // the feed is live, so stream events drive the refetches
    await expect(page.getByTestId(TEST_IDS.feedStatus)).toHaveText('Live');
    // the hidden previous page (Overview) has a counter too; follow the one on screen
    const status = page.getByTestId(TEST_IDS.thresholdStatus(AGENT)).filter({ visible: true });

    // ₹5,000 of ₹10,000: under the limit
    await expect(status).toHaveAttribute('data-threshold', 'under');
    await expect(status).toHaveText('Under the limit');
    // ₹9,500 (95%): amber
    totals.show([generatePayerTotal({ valuePaise: 950_000 })]);
    await expect(status).toHaveAttribute('data-threshold', 'near', { timeout: 15_000 });
    await expect(status).toHaveText('Nearing the limit');
    // ₹10,006.52: crossed, and a verified resident now pays 1%
    totals.show([generatePayerTotal({ valuePaise: 1_000_652 })]);
    await expect(status).toHaveAttribute('data-threshold', 'crossed', { timeout: 15_000 });
    await expect(status).toHaveText('1% reserved');
  });
});
