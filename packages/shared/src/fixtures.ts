import {
  aggregateRowSchema,
  ledgerPageSchema,
  outsidePaymentRowSchema,
  streamEventSchema
} from './console-api';
import { supportedResponseSchema } from './facilitator-api';
import { transactionIdSchema } from './ids';
import { hashscanTransaction } from './links';
import { agentRowSchema, policySchema } from './registry';
import {
  challanRowSchema,
  monthlyCloseSchema,
  payerReportRowSchema,
  releaseRowSchema,
  tdsExportRowSchema
} from './tax-reports';
import { z } from 'zod';

// Realistic demo data for the Console (KOSHA_MOCK=1) and for tests. Every fixture is parsed
// through its schema when this module loads, so a fixture can never drift from its contract.
// FX is ₹88.40 per USD: a 0.10 USDC call is worth 884 paise; 1% TDS is 1019 micro-USDC and 20% is
// 20023 micro-USDC (both rounded up).

const RECEIVER_IN = 'rcv_in';
const AGENT_RESIDENT = 'agt_resident';
const AGENT_UNKNOWN = 'agt_unknown';
const AGENT_NONRESIDENT = 'agt_nonresident';

const txId = (seconds: number): string => `0.0.4000@${seconds}.000000001`;
const hashscan = (seconds: number): string =>
  hashscanTransaction('testnet', transactionIdSchema.parse(txId(seconds)));

const ledgerRow = (seconds: number, fields: Record<string, unknown>) => ({
  paymentId: `pay_${seconds}`,
  quoteId: `q_${seconds}`,
  transactionId: txId(seconds),
  consensusAt: new Date(seconds * 1000).toISOString(),
  receiverId: RECEIVER_IN,
  agentId: AGENT_RESIDENT,
  agentLabel: 'Research agent (resident)',
  mode: 'kosha_split',
  priceMicro: '100000',
  tdsMicro: '0',
  inrValuePaise: '884',
  rateBps: 0,
  reason: 'under_threshold',
  flags: [],
  reserveAccountId: '0.0.6101',
  hashscanUrl: hashscan(seconds),
  hcsSequence: seconds - 1762424000,
  sample: false,
  ...fields
});

export const LEDGER_PAGE_FIXTURE = ledgerPageSchema.parse({
  rows: [
    ledgerRow(1762424460, { tdsMicro: '1019', rateBps: 100, reason: 'threshold_crossed' }),
    ledgerRow(1762424430, {}),
    ledgerRow(1762424400, {
      agentId: AGENT_UNKNOWN,
      agentLabel: 'Unverified agent (Level 0)',
      tdsMicro: '20023',
      rateBps: 2000,
      reason: 'tolerance_exceeded',
      reserveAccountId: '0.0.6103'
    }),
    ledgerRow(1762424370, {
      agentId: AGENT_NONRESIDENT,
      agentLabel: 'Agent (non-resident)',
      reason: 'non_resident',
      flags: ['fema_review'],
      reserveAccountId: null
    }),
    ledgerRow(1762424340, { mode: 'compat', hcsSequence: null }),
    ledgerRow(1754000000, { sample: true, hcsSequence: 3 })
  ],
  nextCursor: 'cur_1754000000'
});

export const AGGREGATES_FIXTURE = z.array(aggregateRowSchema).parse([
  {
    receiverId: RECEIVER_IN,
    agentId: AGENT_RESIDENT,
    agentLevel: 1,
    payerResidency: 'resident',
    fy: '2026-27',
    valuePaise: '1000652',
    outsideValuePaise: '0',
    thresholdPaise: '1000000',
    tolerancePaise: null,
    pct: 100.07
  },
  {
    receiverId: RECEIVER_IN,
    agentId: AGENT_UNKNOWN,
    agentLevel: 0,
    payerResidency: 'unknown',
    fy: '2026-27',
    valuePaise: '450000',
    outsideValuePaise: '0',
    thresholdPaise: '1000000',
    tolerancePaise: '500000',
    pct: 90
  }
]);

export const OUTSIDE_PAYMENTS_FIXTURE = z.array(outsidePaymentRowSchema).parse([
  {
    id: 'out_1',
    receiverId: RECEIVER_IN,
    fromWallet: '0.0.6001',
    transactionId: '0.0.6001@1762425000.000000001',
    seenAt: '2026-11-06T10:50:12Z',
    valuePaise: '44200',
    shortfallPaise: '442',
    classification: 'pending',
    note: null,
    hcsSequence: 61
  }
]);

export const STREAM_EVENTS_FIXTURE = z.array(streamEventSchema).parse([
  { type: 'payment.settled', row: LEDGER_PAGE_FIXTURE.rows[0] },
  {
    type: 'tds.withheld',
    paymentId: 'pay_1762424460',
    tdsMicro: '1019',
    reserveAccountId: '0.0.6101'
  },
  {
    type: 'threshold.near',
    receiverId: RECEIVER_IN,
    agentId: AGENT_UNKNOWN,
    pct: 90,
    promptLevel1: true
  },
  { type: 'outside.payment', row: OUTSIDE_PAYMENTS_FIXTURE[0] }
]);

export const TDS_EXPORT_FIXTURE = z.array(tdsExportRowSchema).parse([
  {
    deducteeRef: 'ABCPK****Q',
    considerationPaise: '884',
    tdsPaise: '9',
    rateBps: 100,
    fundedBy: 'deductee_reserve',
    paymentDate: '2026-11-06',
    deductionDate: '2026-11-06',
    section: '393(1)',
    hcsSequence: 460,
    transactionId: txId(1762424460)
  }
]);

export const MONTHLY_CLOSE_FIXTURE = monthlyCloseSchema.parse({
  receiverId: RECEIVER_IN,
  month: '2026-11',
  section: '393(1)',
  deductorRef: 'MUMD*****E',
  totalTdsPaise: '186',
  rows: [
    {
      agentId: AGENT_RESIDENT,
      deducteeRef: 'ABCPK****Q',
      tdsPaise: '9',
      tdsMicro: '1019',
      reserveAccountId: '0.0.6101'
    },
    {
      agentId: AGENT_UNKNOWN,
      deducteeRef: 'unverified',
      tdsPaise: '177',
      tdsMicro: '20023',
      reserveAccountId: '0.0.6103'
    }
  ]
});

export const CHALLANS_FIXTURE = z
  .array(challanRowSchema)
  .parse([
    {
      id: 'chl_1',
      receiverId: RECEIVER_IN,
      month: '2026-10',
      tdsPaise: '4512',
      recordedAt: '2026-11-05T09:00:00Z',
      hcsSequence: 58
    }
  ]);

export const RELEASES_FIXTURE = z.array(releaseRowSchema).parse([
  {
    id: 'rel_1',
    challanId: 'chl_1',
    agentId: AGENT_RESIDENT,
    reserveAccountId: '0.0.6101',
    micro: '510432',
    scheduleId: '0.0.8001',
    status: 'executed',
    cosignedBy: 'agent operator (demo signer)'
  },
  {
    id: 'rel_2',
    challanId: 'chl_1',
    agentId: AGENT_UNKNOWN,
    reserveAccountId: '0.0.6103',
    micro: '120138',
    scheduleId: '0.0.8002',
    status: 'scheduled',
    cosignedBy: null
  }
]);

export const AGENTS_FIXTURE = z.array(agentRowSchema).parse([
  {
    agentId: AGENT_RESIDENT,
    identity: 'uaid:aid:7Hq3JX9;uid=0;registry=kosha;proto=hcs-10;nativeId=hedera:testnet:0.0.6001',
    level: 1,
    residency: 'resident',
    panOnFile: true,
    wallets: ['0.0.6001'],
    reserveAccountId: '0.0.6101',
    credentialIssuer: 'did:key:z6MkKoshaTestIssuer',
    verifiedAt: '2026-11-06T08:00:00Z'
  },
  {
    agentId: AGENT_UNKNOWN,
    identity: 'hedera:testnet:0.0.6003',
    level: 0,
    residency: 'unknown',
    panOnFile: false,
    wallets: ['0.0.6003'],
    reserveAccountId: '0.0.6103',
    credentialIssuer: null,
    verifiedAt: null
  }
]);

export const POLICY_FIXTURE = policySchema.parse({
  perPaymentMicro: '500000',
  dailyMicro: '5000000',
  fyBudgetMicro: '200000000',
  allowlist: ['api.demo-in.dev', 'api.demo-global.dev'],
  thresholdAction: 'warn',
  acceptRulepacks: ['in-2026.*']
});

export const PAYER_REPORT_FIXTURE = z
  .array(payerReportRowSchema)
  .parse([
    {
      paymentId: 'pay_1762424460',
      spentAt: '2026-11-06T10:21:00Z',
      micro: '101019',
      inrValuePaise: '894',
      costPaise: '880',
      gainPaise: '14'
    }
  ]);

export const SUPPORTED_FIXTURE = supportedResponseSchema.parse({
  kinds: ['kosha-split', 'exact'].map((scheme) => ({
    x402Version: 2,
    scheme,
    network: 'hedera:testnet',
    extra: { feePayer: '0.0.4000' }
  })),
  extensions: [],
  signers: { 'hedera:*': ['0.0.4000'] },
  kosha: { rulepack: { id: 'in-2026.2', hash: '3f'.repeat(32), reviewedBy: null } }
});
