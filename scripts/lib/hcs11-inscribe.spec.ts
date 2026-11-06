import {
  decodeHcs1,
  encodeHcs1,
  HCS1_CHUNK_BYTES,
  inscribeProfile,
  profileMemo
} from './hcs11-inscribe';
import { type Runner } from './hedera-run';
import {
  AccountUpdateTransaction,
  PrivateKey,
  TopicCreateTransaction,
  TopicId,
  TopicMessageSubmitTransaction,
  type Transaction,
  type TransactionReceipt
} from '@hiero-ledger/sdk';
import { describe, expect, it } from 'vitest';

const PROFILE = {
  version: '1.0',
  type: 1,
  ['display_name' as string]: 'Kosha demo agent',
  uaid: 'uaid:aid:abc;uid=0;registry=kosha;proto=hcs-10;nativeId=hedera:testnet:0.0.6001',
  aiAgent: { type: 1, capabilities: [0], model: 'claude-sonnet-5-5' },
  properties: { kosha: { credentialHash: 'sha256:0', wallets: ['0.0.6001'] } }
};

describe('encodeHcs1 and decodeHcs1', () => {
  it('round-trips the JSON and names the raw hash in the memo', () => {
    const json = JSON.stringify(PROFILE);
    const { memo, chunks } = encodeHcs1(json);
    expect(memo).toMatch(/^[0-9a-f]{64}:zstd:base64$/);
    expect(chunks[0]?.c.startsWith('data:application/json;base64,')).toBe(true);
    expect(chunks.every((chunk) => chunk.c.length <= HCS1_CHUNK_BYTES)).toBe(true);
    // Reading in any order still yields the file
    expect(decodeHcs1(memo, [...chunks].reverse())).toEqual({ ok: true, data: json });
  });

  it('splits a large profile into ordered chunks', () => {
    const big = JSON.stringify({
      ...PROFILE,
      bio: 'x'
        .repeat(5000)
        .replace(/x/g, () => String.fromCharCode(97 + Math.floor(Math.random() * 26)))
    });
    const { chunks } = encodeHcs1(big);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.o)).toEqual(chunks.map((_, index) => index));
  });

  it('refuses a file whose hash does not match the memo', () => {
    const { chunks } = encodeHcs1('{"a":1}');
    expect(decodeHcs1(`${'0'.repeat(64)}:zstd:base64`, chunks)).toEqual({
      ok: false,
      data: 'hash_mismatch'
    });
    expect(decodeHcs1('nope', chunks)).toEqual({ ok: false, data: 'bad_memo' });
  });
});

describe('inscribeProfile', () => {
  const key = PrivateKey.generateED25519();
  const agent = { accountId: '0.0.6001', key };

  // Records every transaction and answers a topic ID for the create
  const fakeRunner = (failAt?: new (...args: never[]) => Transaction) => {
    const seen: Transaction[] = [];
    const run: Runner = async (transaction) => {
      seen.push(transaction);
      if (failAt && transaction instanceof failAt)
        return { ok: false, data: { status: 'INSUFFICIENT_PAYER_BALANCE' } };
      const receipt = { topicId: TopicId.fromString('0.0.7001') } as unknown as TransactionReceipt;
      return { ok: true, data: receipt };
    };
    return { run, seen };
  };

  it('creates the topic, submits every chunk and points the account memo at it', async () => {
    const { run, seen } = fakeRunner();
    const result = await inscribeProfile(run, agent, PROFILE);
    expect(result).toEqual({ ok: true, data: { topicId: '0.0.7001', chunks: 1 } });
    expect(seen[0]).toBeInstanceOf(TopicCreateTransaction);
    expect(seen[1]).toBeInstanceOf(TopicMessageSubmitTransaction);
    const update = seen.at(-1);
    expect(update).toBeInstanceOf(AccountUpdateTransaction);
    expect((update as AccountUpdateTransaction).accountMemo).toBe(profileMemo('0.0.7001'));
  });

  it('names the step that failed', async () => {
    const { run } = fakeRunner(TopicMessageSubmitTransaction);
    expect(await inscribeProfile(run, agent, PROFILE)).toEqual({
      ok: false,
      data: { step: 'chunk_0', status: 'INSUFFICIENT_PAYER_BALANCE' }
    });
  });
});
