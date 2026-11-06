import { readAggregates } from './aggregate-read';
import type { KoshaDb } from './db/client';
import type { EventBus } from './event-bus';
import { ledgerRowById } from './ledger-read';
import { pctOfLimit } from './pair-limits';
import type { SettledPayment } from './payment-settle';
import type { HederaNetwork } from '@kosha/shared/ids';
import type { RulePack } from '@kosha/tax-engine/rule-pack';

// The Console's counter turns amber here, and a Level 0 payer is asked to verify
export const NEAR_PCT = 90;

export type AnnounceDeps = {
  db: KoshaDb;
  bus: EventBus;
  pack: RulePack;
  network: HederaNetwork;
};

// Tells the receiver's Console about a settled payment: the ledger row, the TDS reserved (if any),
// and threshold.near on the payment that takes the pair to 90% of its nearer limit. The pair total
// comes from the settlement itself, read under the pair's lock, so exactly one payment crosses.
export const announceSettlement = async (
  deps: AnnounceDeps,
  settled: SettledPayment
): Promise<void> => {
  const row = await ledgerRowById(deps.db, deps.network, settled.paymentId);
  if (!row) return;
  const { receiverId, agentId } = row;
  deps.bus.publish(receiverId, { type: 'payment.settled', row });
  if (BigInt(row.tdsMicro) > 0n) {
    deps.bus.publish(receiverId, {
      type: 'tds.withheld',
      paymentId: row.paymentId,
      tdsMicro: row.tdsMicro,
      reserveAccountId: row.reserveAccountId
    });
  }

  const [pair] = await readAggregates(deps.db, deps.pack, {
    fy: settled.quote.fy,
    receiverId,
    agentId
  });
  if (!pair) return;
  const limits = {
    thresholdPaise: BigInt(pair.thresholdPaise),
    tolerancePaise: pair.tolerancePaise === null ? null : BigInt(pair.tolerancePaise)
  };
  const after = pctOfLimit(settled.aggregatePaise, limits);
  const before = pctOfLimit(settled.aggregatePaise - settled.quote.inrValuePaise, limits);
  if (before < NEAR_PCT && after >= NEAR_PCT) {
    deps.bus.publish(receiverId, {
      type: 'threshold.near',
      receiverId,
      agentId,
      pct: after,
      promptLevel1: pair.agentLevel === 0
    });
  }
};
