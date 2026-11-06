import { type Runner } from './hedera-run';
import {
  AccountUpdateTransaction,
  type PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk';
import { createHash } from 'node:crypto';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';

// An HCS-11 profile inscribed the HCS-1 way (B23, docs/research/hcs-14.md), with the SDK only:
// the JSON is zstd-compressed, base64-encoded with a data prefix and split into chunks of at most
// 1,024 bytes; a topic whose memo is `<sha256 of the raw JSON>:zstd:base64` (submit key, no admin
// key) holds one `{ o, c }` message per chunk; the account memo `hcs-11:hcs://1/<topic>` points
// at it. Core's profile reader (@kosha/hedera/hcs11-profile) follows exactly that chain.

export const HCS1_CHUNK_BYTES = 1024;
const DATA_PREFIX = 'data:application/json;base64,';

export type Hcs1Chunk = { o: number; c: string };

export const encodeHcs1 = (json: string): { memo: string; chunks: Hcs1Chunk[] } => {
  const raw = Buffer.from(json, 'utf8');
  const hash = createHash('sha256').update(raw).digest('hex');
  const encoded = `${DATA_PREFIX}${zstdCompressSync(raw).toString('base64')}`;
  // Each message is the serialized { o, c }, so its envelope comes out of the 1,024 bytes; a
  // larger message would be split by the SDK into pieces no HCS-1 reader can parse
  const chunks: Hcs1Chunk[] = [];
  let offset = 0;
  while (offset < encoded.length) {
    const envelope = JSON.stringify({ o: chunks.length, c: '' }).length;
    const size = HCS1_CHUNK_BYTES - envelope;
    chunks.push({ o: chunks.length, c: encoded.slice(offset, offset + size) });
    offset += size;
  }
  return { memo: `${hash}:zstd:base64`, chunks };
};

// What a reader does: order the chunks, drop the prefix, decode, decompress, check the hash
export const decodeHcs1 = (
  memo: string,
  chunks: Hcs1Chunk[]
): { ok: true; data: string } | { ok: false; data: 'hash_mismatch' | 'bad_memo' } => {
  const [hash, algo, encoding] = memo.split(':');
  if (!hash || algo !== 'zstd' || encoding !== 'base64') return { ok: false, data: 'bad_memo' };
  const joined = [...chunks]
    .sort((a, b) => a.o - b.o)
    .map((chunk) => chunk.c)
    .join('');
  const base64 = joined.startsWith(DATA_PREFIX) ? joined.slice(DATA_PREFIX.length) : joined;
  const raw = zstdDecompressSync(Buffer.from(base64, 'base64'));
  const actual = createHash('sha256').update(raw).digest('hex');
  return actual === hash
    ? { ok: true, data: raw.toString('utf8') }
    : { ok: false, data: 'hash_mismatch' };
};

export const profileMemo = (topicId: string): string => `hcs-11:hcs://1/${topicId}`;

export type InscribeResult =
  | { ok: true; data: { topicId: string; chunks: number } }
  | { ok: false; data: { step: string; status: string } };

// The agent's own account is the runner's operator: it pays the fees, owns the topic's submit key
// and signs its own memo update, which is what binds the UAID to the account.
export const inscribeProfile = async (
  run: Runner,
  agent: { accountId: string; key: PrivateKey },
  profile: unknown
): Promise<InscribeResult> => {
  const { memo, chunks } = encodeHcs1(JSON.stringify(profile));

  const created = await run(
    new TopicCreateTransaction().setTopicMemo(memo).setSubmitKey(agent.key.publicKey)
  );
  if (!created.ok)
    return { ok: false, data: { step: 'topic_create', status: created.data.status } };
  const topicId = created.data.topicId?.toString();
  if (!topicId) return { ok: false, data: { step: 'topic_create', status: 'NO_TOPIC_ID' } };

  for (const chunk of chunks) {
    const sent = await run(
      new TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(JSON.stringify(chunk))
        .setMaxChunks(1)
    );
    if (!sent.ok)
      return { ok: false, data: { step: `chunk_${chunk.o}`, status: sent.data.status } };
  }

  const updated = await run(
    new AccountUpdateTransaction()
      .setAccountId(agent.accountId)
      .setAccountMemo(profileMemo(topicId)),
    [agent.key]
  );
  if (!updated.ok)
    return { ok: false, data: { step: 'account_memo', status: updated.data.status } };

  return { ok: true, data: { topicId, chunks: chunks.length } };
};
