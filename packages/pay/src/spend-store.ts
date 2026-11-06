import { financialYear, istDayKey } from '@kosha/tax-engine/ist-calendar';

export type SpendTotals = {
  // Spent so far on the IST calendar day of `at`
  dayMicro: bigint;
  // Spent so far in the financial year of `at`
  fyMicro: bigint;
};

// Where Pay keeps what it has spent. In memory for the demo; a file or database store can
// implement the same interface without touching the policy check. A payment is recorded when it
// is signed, before it is sent, and released only if it is never sent or the server refuses it.
export type SpendStore = {
  totals: (at: Date) => Promise<SpendTotals>;
  record: (at: Date, totalMicro: bigint) => Promise<void>;
  // Undoes a `record` made at the same `at`
  release: (at: Date, totalMicro: bigint) => Promise<void>;
};

const locks = new WeakMap<SpendStore, Promise<void>>();

const settled = async (promise: Promise<unknown>): Promise<void> => {
  try {
    await promise;
  } catch {
    // The task's own caller sees the error; the lock only waits for it to finish
  }
};

// Runs `task` with no other locked task on the same store in between, so reading the totals and
// recording against them can't interleave with another payment: two in flight can't both fit
// under the same headroom. In-process only; a store shared between processes needs a transaction.
export const withSpendLock = async <T>(store: SpendStore, task: () => Promise<T>): Promise<T> => {
  const previous = locks.get(store) ?? Promise.resolve();
  const run = (async () => {
    await previous;
    return task();
  })();
  locks.set(store, settled(run));
  return run;
};

const dayKey = (at: Date) => `day:${istDayKey(at)}`;
const fyKey = (at: Date) => `fy:${financialYear(at)}`;

export const createMemorySpendStore = (): SpendStore => {
  const spent = new Map<string, bigint>();
  const add = (key: string, amount: bigint) => spent.set(key, (spent.get(key) ?? 0n) + amount);
  const subtract = (key: string, amount: bigint) => {
    const left = (spent.get(key) ?? 0n) - amount;
    spent.set(key, left > 0n ? left : 0n);
  };
  const checkAmount = (totalMicro: bigint) => {
    if (totalMicro < 0n) {
      throw new RangeError('[spend-store]: a payment must not be negative');
    }
  };

  return {
    totals: async (at) => ({
      dayMicro: spent.get(dayKey(at)) ?? 0n,
      fyMicro: spent.get(fyKey(at)) ?? 0n
    }),
    record: async (at, totalMicro) => {
      checkAmount(totalMicro);
      add(dayKey(at), totalMicro);
      add(fyKey(at), totalMicro);
    },
    release: async (at, totalMicro) => {
      checkAmount(totalMicro);
      subtract(dayKey(at), totalMicro);
      subtract(fyKey(at), totalMicro);
    }
  };
};
