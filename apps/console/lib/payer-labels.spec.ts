import { payerLabels } from '@/lib/payer-labels';
import { LEDGER_PAGE_FIXTURE } from '@kosha/shared/fixtures';
import { describe, expect, it } from 'vitest';

describe('payerLabels', () => {
  it("maps each payer's ID to the label on its newest ledger row", () => {
    const [first, ...rest] = LEDGER_PAGE_FIXTURE.rows;
    if (!first) throw new Error('the ledger fixture has no rows');
    const rows = [{ ...first, agentLabel: 'hedera:testnet:0.0.6001 (newest)' }, ...rest];

    const labels = payerLabels(rows);

    expect(labels.get(first.agentId)).toBe('hedera:testnet:0.0.6001 (newest)');
    expect(labels.size).toBe(new Set(rows.map((row) => row.agentId)).size);
  });

  it('is empty before the ledger loads', () => {
    expect(payerLabels(undefined).size).toBe(0);
  });
});
