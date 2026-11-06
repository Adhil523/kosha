import type { AccountId, HederaNetwork, ScheduleId, TopicId, TransactionId } from './ids';

const HASHSCAN_BASE_URL = 'https://hashscan.io';

// 0.0.4000@1762424400.123456789 → 0.0.4000-1762424400-123456789, the form the Mirror Node and
// HashScan use in URLs
export const toMirrorTransactionId = (transactionId: TransactionId): string => {
  const [payer = '', validStart = ''] = transactionId.replace('?scheduled', '').split('@');
  return `${payer}-${validStart.replace('.', '-')}`;
};

export const hashscanTransaction = (network: HederaNetwork, transactionId: TransactionId): string =>
  `${HASHSCAN_BASE_URL}/${network}/transaction/${toMirrorTransactionId(transactionId)}`;

export const hashscanAccount = (network: HederaNetwork, accountId: AccountId): string =>
  `${HASHSCAN_BASE_URL}/${network}/account/${accountId}`;

export const hashscanTopic = (network: HederaNetwork, topicId: TopicId): string =>
  `${HASHSCAN_BASE_URL}/${network}/topic/${topicId}`;

// A scheduled transaction: its signatures so far, and the transfer once it has run
export const hashscanSchedule = (network: HederaNetwork, scheduleId: ScheduleId): string =>
  `${HASHSCAN_BASE_URL}/${network}/schedule/${scheduleId}`;

// One HCS message as JSON, for an evidence link that names the exact sequence number
export const mirrorTopicMessage = (mirrorUrl: string, topicId: TopicId, sequence: number): string =>
  `${mirrorUrl.replace(/\/+$/, '')}/api/v1/topics/${topicId}/messages/${sequence}`;
