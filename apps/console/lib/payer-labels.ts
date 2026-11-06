/* eslint-disable @typescript-eslint/naming-convention -- keys are residency values as @kosha/shared sends them (snake_case) */
import type { LedgerRow } from '@kosha/shared/console-api';
import type { PayerResidency } from '@kosha/shared/facilitator-api';
import type { AgentLevel } from '@kosha/shared/registry';

export const RESIDENCY_LABELS: Record<PayerResidency, string> = {
  resident: 'Resident',
  non_resident: 'Non-resident',
  unknown: 'Residency unknown'
};

// Spec "step-by-step verification": 0 none; 1 PAN name-matched or a non-resident declaration;
// 2 full KYC for large payers
export const LEVEL_LABELS: Record<AgentLevel, string> = {
  0: 'Level 0 · unverified',
  1: 'Level 1 · PAN or declaration',
  2: 'Level 2 · full KYC'
};

// Core's aggregates name a payer by its internal ID; its ledger rows carry the readable label (the
// agent's UAID or account). Newest row wins.
export const payerLabels = (rows: readonly LedgerRow[] = []): ReadonlyMap<string, string> => {
  const labels = new Map<string, string>();
  for (const row of rows) if (!labels.has(row.agentId)) labels.set(row.agentId, row.agentLabel);
  return labels;
};
