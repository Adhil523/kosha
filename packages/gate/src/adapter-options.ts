import { type GateOptions, type KoshaContext } from './gate-handler';

export type SettleMode = 'before' | 'after';

// What every framework adapter (Express, Hono) takes on top of the handler's options
export type AdapterOptions = GateOptions & {
  // "before" (the default) settles before the handler runs, so data is never served unpaid.
  // "after" verifies first, runs the handler, and settles only if it answered 2xx.
  settleMode?: SettleMode;
  onSettled?: (kosha: KoshaContext) => void;
};

export const isSuccess = (status: number): boolean => status >= 200 && status < 300;

// A throwing callback must never break the response that already settled
export const notifySettled = (
  onSettled: AdapterOptions['onSettled'],
  kosha: KoshaContext
): void => {
  try {
    onSettled?.(kosha);
  } catch (error) {
    console.error('[kosha-gate]: onSettled threw', error);
  }
};
