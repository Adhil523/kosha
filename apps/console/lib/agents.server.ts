import 'server-only';
import { type AgentView, readTokenBalance } from '@/lib/agents';
import { api, type ApiError, type ApiResponse } from '@/lib/api';
import { getAgents, isMockMode } from '@/lib/core.server';
import { mirrorUrl } from '@/lib/display-config.server';
import { URLS } from '@/lib/urls';
import { LEDGER_PAGE_FIXTURE } from '@kosha/shared/fixtures';
import { amountSchema } from '@kosha/shared/money';

// Mock mode: a reserve holds the TDS the sample payments put into it
const sampleReserveBalance = (accountId: string): string =>
  LEDGER_PAGE_FIXTURE.rows
    .filter((row) => row.reserveAccountId === accountId)
    .reduce((sum, row) => sum + BigInt(row.tdsMicro), 0n)
    .toString();

// The reserve's settlement-token balance, read from the Mirror Node; null if it can't be read
const reserveBalance = async (accountId: string): Promise<string | null> => {
  if (isMockMode()) return sampleReserveBalance(accountId);
  const tokenId = process.env.SETTLEMENT_TOKEN_ID?.trim();
  if (!tokenId) return null;
  const response = await api.get<unknown>(
    URLS.mirror.accountTokens(mirrorUrl(), accountId, tokenId)
  );
  if (!response.ok) {
    console.error(`[agents]: Mirror Node balance for ${accountId} failed (${response.status})`);
    return null;
  }
  return readTokenBalance(response.data, tokenId);
};

export const getAgentViews = async (): Promise<ApiResponse<AgentView[], ApiError>> => {
  const agents = await getAgents();
  if (!agents.ok) return agents;
  const views = await Promise.all(
    agents.data.map(async (agent) => {
      const balance = agent.reserveAccountId ? await reserveBalance(agent.reserveAccountId) : null;
      return {
        ...agent,
        reserveBalanceMicro: balance === null ? null : amountSchema.parse(balance)
      };
    })
  );
  return { ok: true, status: 200, data: views };
};
