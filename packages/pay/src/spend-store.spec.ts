import { createMemorySpendStore } from './spend-store';
import { describe, expect, it } from 'vitest';

// 2026-11-06 23:00 IST and the next IST day, 30 minutes later
const LATE_EVENING = new Date('2026-11-06T17:30:00Z');
const AFTER_MIDNIGHT_IST = new Date('2026-11-06T18:30:00Z');
// 31 March and 1 April 2027 in IST: the financial year rolls over
const FY_LAST_DAY = new Date('2027-03-31T12:00:00Z');
const FY_FIRST_DAY = new Date('2027-04-01T12:00:00Z');

describe('createMemorySpendStore', () => {
  it('starts empty', async () => {
    expect(await createMemorySpendStore().totals(LATE_EVENING)).toEqual({
      dayMicro: 0n,
      fyMicro: 0n
    });
  });

  it('adds payments to the day and the financial year', async () => {
    const store = createMemorySpendStore();

    await store.record(LATE_EVENING, 101_019n);
    await store.record(LATE_EVENING, 250_000n);

    expect(await store.totals(LATE_EVENING)).toEqual({ dayMicro: 351_019n, fyMicro: 351_019n });
  });

  it('resets the daily total at IST midnight, not UTC midnight', async () => {
    const store = createMemorySpendStore();

    await store.record(LATE_EVENING, 100_000n);

    expect(await store.totals(AFTER_MIDNIGHT_IST)).toEqual({ dayMicro: 0n, fyMicro: 100_000n });
  });

  it('resets the yearly total on 1 April', async () => {
    const store = createMemorySpendStore();

    await store.record(FY_LAST_DAY, 100_000n);

    expect((await store.totals(FY_FIRST_DAY)).fyMicro).toBe(0n);
  });

  it('rejects a negative payment', async () => {
    await expect(createMemorySpendStore().record(LATE_EVENING, -1n)).rejects.toThrow(RangeError);
  });
});
