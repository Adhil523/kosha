import { getAgentLedger, getPolicy, isMockMode } from '@/lib/core.server';
import { AGENT_VIEWERS, requireWorkspace } from '@/lib/route-guard.server';
import { istFinancialYearStart, spendSummary } from '@/lib/spend';
import { LEDGER_PAGE_FIXTURE } from '@kosha/shared/fixtures';
import { amountToBigint } from '@kosha/shared/money';

// The sample payments are dated; measure mock mode from the newest so the year has data
const summaryClock = (): Date => {
  const newest = LEDGER_PAGE_FIXTURE.rows[0];
  return isMockMode() && newest ? new Date(newest.consensusAt) : new Date();
};

// One agent's spend this financial year, by API and by day, against its yearly budget
export const GET = async (_request: Request, context: RouteContext<'/api/agents/[id]/spend'>) => {
  const denied = await requireWorkspace(AGENT_VIEWERS);
  if (denied) return denied;
  const { id } = await context.params;
  const now = summaryClock();
  const [rows, policy] = await Promise.all([
    getAgentLedger(id, istFinancialYearStart(now)),
    getPolicy(id)
  ]);
  if (!rows.ok) return Response.json(rows.data, { status: rows.status || 502 });
  if (!policy.ok) return Response.json(policy.data, { status: policy.status || 502 });
  const fyBudgetMicro = policy.data ? amountToBigint(policy.data.fyBudgetMicro) : null;
  return Response.json(spendSummary(rows.data, { now, fyBudgetMicro }));
};
