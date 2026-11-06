import {
  accountIdSchema,
  agentIdentitySchema,
  quoteIdSchema,
  topicIdSchema,
  transactionIdSchema
} from './ids';
import {
  hashscanAccount,
  hashscanTopic,
  hashscanTransaction,
  mirrorTopicMessage,
  toMirrorTransactionId
} from './links';
import { describe, expect, it } from 'vitest';

const UAID = 'uaid:aid:7Hq3JX9;uid=0;registry=kosha;proto=hcs-10;nativeId=hedera:testnet:0.0.6001';

describe('ids', () => {
  it('accepts entity ids and rejects other shapes', () => {
    expect(accountIdSchema.safeParse('0.0.4000').success).toBe(true);
    expect(accountIdSchema.safeParse('0x00000000000000000000000000000000000fa0').success).toBe(
      false
    );
    expect(accountIdSchema.safeParse('0.0').success).toBe(false);
  });

  it('accepts SDK transaction ids, including scheduled ones', () => {
    expect(transactionIdSchema.safeParse('0.0.4000@1762424400.123456789').success).toBe(true);
    expect(transactionIdSchema.safeParse('0.0.4000@1762424400.1?scheduled').success).toBe(true);
    expect(transactionIdSchema.safeParse('0.0.4000-1762424400-123456789').success).toBe(false);
  });

  it('accepts quote ids with the q_ prefix only', () => {
    expect(quoteIdSchema.safeParse('q_7f3a').success).toBe(true);
    expect(quoteIdSchema.safeParse('7f3a').success).toBe(false);
  });

  it('identifies an agent by UAID or by CAIP-10 account', () => {
    expect(agentIdentitySchema.safeParse(UAID).success).toBe(true);
    expect(agentIdentitySchema.safeParse('hedera:testnet:0.0.6001').success).toBe(true);
    expect(agentIdentitySchema.safeParse('hedera:previewnet:0.0.6001').success).toBe(false);
    expect(agentIdentitySchema.safeParse('0.0.6001').success).toBe(false);
  });
});

describe('links', () => {
  const txId = transactionIdSchema.parse('0.0.4000@1762424400.123456789');

  it('converts a transaction id to the mirror form', () => {
    expect(toMirrorTransactionId(txId)).toBe('0.0.4000-1762424400-123456789');
  });

  it('builds HashScan and Mirror Node links', () => {
    const topic = topicIdSchema.parse('0.0.7001');
    expect(hashscanTransaction('testnet', txId)).toBe(
      'https://hashscan.io/testnet/transaction/0.0.4000-1762424400-123456789'
    );
    expect(hashscanAccount('testnet', accountIdSchema.parse('0.0.5001'))).toBe(
      'https://hashscan.io/testnet/account/0.0.5001'
    );
    expect(hashscanTopic('testnet', topic)).toBe('https://hashscan.io/testnet/topic/0.0.7001');
    expect(mirrorTopicMessage('https://testnet.mirrornode.hedera.com/', topic, 42)).toBe(
      'https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.7001/messages/42'
    );
  });
});
