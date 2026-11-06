import type { LedgerPage, LedgerRow } from '@kosha/shared/console-api';

// A settled payment from the stream goes to the top of the cached first page. A row the poll
// already brought in is replaced, never duplicated.
export const prependLedgerRow = (page: LedgerPage | undefined, row: LedgerRow): LedgerPage => {
  const rest = (page?.rows ?? []).filter((existing) => existing.paymentId !== row.paymentId);
  return { rows: [row, ...rest], nextCursor: page?.nextCursor ?? null };
};
