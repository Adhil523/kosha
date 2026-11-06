import { readRulePack } from './active-rule-pack';
import { hashApiKey } from './auth';
import type { KoshaDb } from './db/client';
import { agent, payment, quote, receiver } from './db/schema';
import { findRepoRoot } from '@kosha/shared/env';
import type { RulePack } from '@kosha/tax-engine/rule-pack';

// Two receivers and two agents with settled history, for the Console read endpoints

export const ADMIN_TOKEN = 'a'.repeat(48);
export const ADMIN = { authorization: `Bearer ${ADMIN_TOKEN}` };
export const RECEIVER_KEYS = { in: `key-in-${'k'.repeat(32)}`, solo: `key-solo-${'k'.repeat(32)}` };
export const receiverAuth = (name: keyof typeof RECEIVER_KEYS) => ({
  authorization: `Bearer ${RECEIVER_KEYS[name]}`
});
export const FY = '2026-27';
export const NOW = new Date('2026-11-06T10:30:00Z');

// The rule pack the demo runs: ₹10,000 and ₹50,000 thresholds, ₹5,000 tolerance
export const loadTestPack = async (): Promise<RulePack> => {
  const loaded = await readRulePack('rulepacks/in-2026.2.json', findRepoRoot(process.cwd()) ?? '');
  if (!loaded.ok) throw new Error(`[ledger-fixture]: ${loaded.data.reason}`);
  return loaded.data.pack;
};

export type LedgerSeed = {
  receivers: { in: string; solo: string };
  agents: { resident: string; unknown: string };
};

export const seedParties = async (db: KoshaDb): Promise<LedgerSeed> => {
  const receivers = await db
    .insert(receiver)
    .values(
      (['in', 'solo'] as const).map((name) => ({
        legalName: `receiver-${name}`,
        residency: 'resident' as const,
        specifiedPerson: name === 'solo',
        mode: 'threshold' as const,
        unverifiedPolicy: 'threshold_tolerant' as const,
        apiKeyHash: hashApiKey(RECEIVER_KEYS[name])
      }))
    )
    .returning({ id: receiver.id });
  const agents = await db
    .insert(agent)
    .values([
      {
        identity: 'hedera:testnet:0.0.6001',
        ownerRef: 'agent-resident',
        level: 1,
        residency: 'resident',
        panOnFile: true,
        reserveAccountID: '0.0.6101'
      },
      { identity: 'hedera:testnet:0.0.6003', level: 0, reserveAccountID: '0.0.6103' }
    ])
    .returning({ id: agent.id });
  const [inId, soloId] = receivers.map((row) => row.id);
  const [residentId, unknownId] = agents.map((row) => row.id);
  if (!inId || !soloId || !residentId || !unknownId) {
    throw new Error('[ledger-fixture]: seed rows were not saved');
  }
  return {
    receivers: { in: inId, solo: soloId },
    agents: { resident: residentId, unknown: unknownId }
  };
};

export type PaymentSeed = {
  receiverId: string;
  agentId: string;
  at: Date;
  status?: 'settled' | 'pending' | 'failed';
  priceMicro?: bigint;
  tdsMicro?: bigint;
  inrValuePaise?: bigint;
  rateBps?: number;
  reason?: string;
  sample?: boolean;
};

let sequence = 0;

// One quote and the payment that settled it, as the ledger records them
export const addPayment = async (db: KoshaDb, seed: PaymentSeed): Promise<string> => {
  sequence += 1;
  const priceMicro = seed.priceMicro ?? 100_000n;
  const tdsMicro = seed.tdsMicro ?? 0n;
  const transactionID = `0.0.6001@${1_762_425_000 + sequence}.000000000`;
  const [quoted] = await db
    .insert(quote)
    .values({
      scheme: 'kosha_split',
      receiverID: seed.receiverId,
      agentID: seed.agentId,
      resource: 'https://api.demo-in.dev/v1/gst-lookup',
      payToAccountID: '0.0.5001',
      reserveAccountID: '0.0.6101',
      priceMicro,
      tdsMicro,
      totalMicro: priceMicro + tdsMicro,
      inrValuePaise: seed.inrValuePaise ?? 884n,
      rateBps: seed.rateBps ?? 0,
      reason: seed.reason ?? 'under_threshold',
      rulepack: 'in-2026.2',
      inrPerUsdMicro: 88_400_000n,
      nodeAccountIDs: ['0.0.3', '0.0.4', '0.0.5'],
      fy: FY,
      createdAt: seed.at,
      expiresAt: new Date(seed.at.getTime() + 120_000),
      usedTransactionID: transactionID
    })
    .returning({ id: quote.id });
  const [paid] = await db
    .insert(payment)
    .values({
      quoteID: quoted?.id ?? '',
      transactionID,
      createdAt: seed.at,
      consensusAt: seed.at,
      receiverID: seed.receiverId,
      agentID: seed.agentId,
      priceMicro,
      tdsMicro,
      reserveAccountID: tdsMicro > 0n ? '0.0.6101' : null,
      inrValuePaise: seed.inrValuePaise ?? 884n,
      fy: FY,
      status: seed.status ?? 'settled',
      sample: seed.sample ?? false
    })
    .returning({ id: payment.id });
  return paid?.id ?? '';
};
