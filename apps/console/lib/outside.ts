/* eslint-disable @typescript-eslint/naming-convention -- keys are Core's classifications (snake_case) */
import { type OutsidePaymentRow } from '@kosha/shared/console-api';

export type Classification = OutsidePaymentRow['classification'];

export const CLASSIFICATION_LABELS: Record<Classification, string> = {
  pending: 'To classify',
  consideration: 'Payment for the API',
  not_consideration_gift: 'Gift, not consideration'
};

export type OutsideSummary = { pending: number; shortfallPaise: bigint };

// What still needs the owner: the transfers not yet classified, and the TDS they should have
// carried. A classified transfer has left the count, whichever way it went.
export const outsideSummary = (rows: readonly OutsidePaymentRow[]): OutsideSummary =>
  rows
    .filter((row) => row.classification === 'pending')
    .reduce(
      (summary, row) => ({
        pending: summary.pending + 1,
        shortfallPaise: summary.shortfallPaise + BigInt(row.shortfallPaise)
      }),
      { pending: 0, shortfallPaise: 0n }
    );
