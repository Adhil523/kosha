import { agentViewsSchema } from '@/lib/agents';
import { api } from '@/lib/api';
import { overviewSchema } from '@/lib/overview';
import { QUERY_KEYS } from '@/lib/query-client';
import { spendSummarySchema } from '@/lib/spend';
import { taxReportSchema } from '@/lib/tax-report';
import { URLS } from '@/lib/urls';
import {
  aggregateRowSchema,
  ledgerPageSchema,
  outsidePaymentRowSchema
} from '@kosha/shared/console-api';
import { policySchema } from '@kosha/shared/registry';
import { z } from 'zod';

// Fetches a Console route and validates it at the boundary; query functions throw on failure
const getValidated = async <T>(url: string, schema: z.ZodType<T>): Promise<T> => {
  const response = await api.get<unknown>(url);
  if (!response.ok) throw new Error(response.data.message || `request failed (${response.status})`);
  const parsed = schema.safeParse(response.data);
  if (!parsed.success) throw new Error('the Console API answered in an unknown shape');
  return parsed.data;
};

export const getLedgerQueryParams = () => ({
  queryKey: QUERY_KEYS.ledger,
  queryFn: () => getValidated(URLS.console.ledger, ledgerPageSchema)
});

export const getAggregatesQueryParams = () => ({
  queryKey: QUERY_KEYS.aggregates,
  queryFn: () => getValidated(URLS.console.aggregates, z.array(aggregateRowSchema))
});

export const getOverviewQueryParams = () => ({
  queryKey: QUERY_KEYS.overview,
  queryFn: () => getValidated(URLS.console.overview, overviewSchema)
});

export const getAgentsQueryParams = () => ({
  queryKey: QUERY_KEYS.agents,
  queryFn: () => getValidated(URLS.console.agents, agentViewsSchema)
});

export const getAgentSpendQueryParams = (agentId: string) => ({
  queryKey: QUERY_KEYS.agentSpend(agentId),
  queryFn: () => getValidated(URLS.console.agentSpend(agentId), spendSummarySchema)
});

// null: the agent has no policy yet, so no caps
export const getAgentPolicyQueryParams = (agentId: string) => ({
  queryKey: QUERY_KEYS.agentPolicy(agentId),
  queryFn: () => getValidated(URLS.console.agentPolicy(agentId), policySchema.nullable())
});

export const getTaxReportQueryParams = (quarter: string) => ({
  queryKey: QUERY_KEYS.taxReport(quarter),
  queryFn: () => getValidated(URLS.console.tax(quarter), taxReportSchema)
});

export const getOutsidePaymentsQueryParams = () => ({
  queryKey: QUERY_KEYS.outsidePayments,
  queryFn: () => getValidated(URLS.console.outsidePayments, z.array(outsidePaymentRowSchema))
});
