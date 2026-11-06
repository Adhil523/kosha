import { financialYear, istDayKey } from '@kosha/tax-engine/ist-calendar';

export type SpendTotals = {
  // Spent so far on the IST calendar day of `at`
  dayMicro: bigint;
  // Spent so far in the financial year of `at`
  fyMicro: bigint;
};

// Where Pay keeps what it has spent. In memory for the demo; a file or database store can
// implement the same interface without touching the policy check.
export type SpendStore = {
  totals: (at: Date) => Promise<SpendTotals>;
  record: (at: Date, totalMicro: bigint) => Promise<void>;
};

const dayKey = (at: Date) => `day:${istDayKey(at)}`;
const fyKey = (at: Date) => `fy:${financialYear(at)}`;

export const createMemorySpendStore = (): SpendStore => {
  const spent = new Map<string, bigint>();
  const add = (key: string, amount: bigint) => spent.set(key, (spent.get(key) ?? 0n) + amount);

  return {
    totals: async (at) => ({
      dayMicro: spent.get(dayKey(at)) ?? 0n,
      fyMicro: spent.get(fyKey(at)) ?? 0n
    }),
    record: async (at, totalMicro) => {
      if (totalMicro < 0n) {
        throw new RangeError('[spend-store]: a payment must not be negative');
      }
      add(dayKey(at), totalMicro);
      add(fyKey(at), totalMicro);
    }
  };
};
