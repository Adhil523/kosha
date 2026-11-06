/* eslint-disable @typescript-eslint/naming-convention -- keys are the tax reasons as @kosha/shared sends them (snake_case) */
import type { TaxReason } from '@kosha/shared/x402-payment';

const BPS_PER_PERCENT = 100;

export const REASON_LABELS: Record<TaxReason, string> = {
  under_threshold: 'Under threshold',
  within_tolerance: 'Within tolerance',
  threshold_crossed: 'Threshold crossed',
  tolerance_exceeded: 'Tolerance exceeded',
  first_rupee: 'First rupee',
  non_resident: 'Non-resident payer',
  receiver_non_resident: 'Non-resident receiver'
};

// 100 → "1% reserved", 2000 → "20% reserved", 0 → "No TDS"
export const reserveLabel = (rateBps: number): string =>
  rateBps === 0 ? 'No TDS' : `${rateBps / BPS_PER_PERCENT}% reserved`;

const IST_TIME = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});
const IST_DATE = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short'
});

// Consensus time in IST, the clock Indian TDS deadlines run on: "06 Nov 15:51:00"
export const formatConsensusTime = (iso: string): string => {
  const date = new Date(iso);
  return `${IST_DATE.format(date)} ${IST_TIME.format(date)}`;
};
