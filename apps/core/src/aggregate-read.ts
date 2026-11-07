import type { KoshaDb } from './db/client';
import { agent, aggregate, receiver } from './db/schema';
import { pairLimits, pctOfLimit } from './pair-limits';
import { type AggregateRow, aggregateRowSchema } from '@kosha/shared/console-api';
import type { RulePack } from '@kosha/tax-engine/rule-pack';
import { and, desc, eq } from 'drizzle-orm';

export type AggregateFilter = { fy: string; receiverId?: string; agentId?: string };

// Each payer–receiver pair's running total for one financial year, with the receiver's threshold,
// the tolerance when the payer is unverified, and how far along the nearer limit the pair is
export const readAggregates = async (
  db: KoshaDb,
  pack: RulePack,
  filter: AggregateFilter
): Promise<AggregateRow[]> => {
  const rows = await db
    .select({
      receiverId: aggregate.receiverID,
      agentId: aggregate.agentID,
      fy: aggregate.fy,
      valuePaise: aggregate.valuePaise,
      outsideValuePaise: aggregate.outsideValuePaise,
      agentLevel: agent.level,
      payerResidency: agent.residency,
      mode: receiver.mode,
      specifiedPerson: receiver.specifiedPerson,
      unverifiedPolicy: receiver.unverifiedPolicy
    })
    .from(aggregate)
    .innerJoin(agent, eq(agent.id, aggregate.agentID))
    .innerJoin(receiver, eq(receiver.id, aggregate.receiverID))
    .where(
      and(
        eq(aggregate.fy, filter.fy),
        filter.receiverId ? eq(aggregate.receiverID, filter.receiverId) : undefined,
        filter.agentId ? eq(aggregate.agentID, filter.agentId) : undefined
      )
    )
    .orderBy(desc(aggregate.valuePaise), aggregate.agentID);

  return rows.map((row) => {
    const limits = pairLimits(pack, row, row.payerResidency);
    return aggregateRowSchema.parse({
      receiverId: row.receiverId,
      agentId: row.agentId,
      agentLevel: row.agentLevel,
      payerResidency: row.payerResidency,
      fy: row.fy,
      valuePaise: row.valuePaise.toString(),
      outsideValuePaise: row.outsideValuePaise.toString(),
      thresholdPaise: limits.thresholdPaise.toString(),
      tolerancePaise: limits.tolerancePaise?.toString() ?? null,
      pct: pctOfLimit(row.valuePaise + row.outsideValuePaise, limits)
    });
  });
};
