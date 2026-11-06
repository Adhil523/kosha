/* eslint-disable @typescript-eslint/naming-convention -- the Mirror Node REST API names its fields in snake_case; these schemas mirror that contract */
import { z } from 'zod';

// A Mirror Node client that uses fetch only and never imports the SDK, so Gate can use it for its
// reserve proof without pulling the SDK into its bundle. Responses are untrusted and validated.
// Token amounts arrive as JSON numbers; Kosha's amounts are far below 2^53.

export type FetchLike = (
  url: string
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type MirrorFailure = {
  ok: false;
  data: { reason: 'not_found' | 'http_error' | 'invalid_response'; status?: number };
};
export type MirrorResult<T> = { ok: true; data: T } | MirrorFailure;

const PAGE_LIMIT = 100;

const accountSchema = z.object({
  key: z.object({ _type: z.string(), key: z.string() }).nullable()
});

const accountMemoSchema = z.object({ memo: z.string() });

const transactionSchema = z.object({
  transaction_id: z.string(),
  consensus_timestamp: z.string(),
  result: z.string(),
  name: z.string(),
  memo_base64: z.string().nullable().optional(),
  token_transfers: z
    .array(z.object({ token_id: z.string(), account: z.string(), amount: z.number().int() }))
    .optional()
});

const transactionsPageSchema = z.object({
  transactions: z.array(transactionSchema),
  links: z.object({ next: z.string().nullable() }).optional()
});

const scheduleSchema = z.object({
  schedule_id: z.string(),
  executed_timestamp: z.string().nullable(),
  deleted: z.boolean(),
  expiration_time: z.string().nullable(),
  payer_account_id: z.string().nullable()
});

const accountTokensSchema = z.object({
  tokens: z.array(z.object({ token_id: z.string(), balance: z.number().int() }))
});

const topicMessageSchema = z.object({ topic_id: z.string(), sequence_number: z.number().int() });

export type MirrorAccountKey = { type: string; hex: string };
export type MirrorTopicMessage = { topicId: string; sequence: number };
export type MirrorTokenTransfer = { tokenId: string; account: string; amount: bigint };
export type MirrorTransaction = {
  transactionId: string;
  consensusTimestamp: string;
  result: string;
  name: string;
  memo: string;
  tokenTransfers: MirrorTokenTransfer[];
};
export type TokenCredit = {
  transactionId: string;
  consensusTimestamp: string;
  memo: string;
  amount: bigint;
  // Accounts debited the same token in that transaction
  from: string[];
};
export type MirrorSchedule = {
  scheduleId: string;
  status: 'pending' | 'executed' | 'deleted';
  executedAt: string | null;
  expiresAt: string | null;
  payerAccountId: string | null;
};

const toTransaction = (raw: z.output<typeof transactionSchema>): MirrorTransaction => ({
  transactionId: raw.transaction_id,
  consensusTimestamp: raw.consensus_timestamp,
  result: raw.result,
  name: raw.name,
  memo: raw.memo_base64 ? Buffer.from(raw.memo_base64, 'base64').toString('utf8') : '',
  tokenTransfers: (raw.token_transfers ?? []).map((transfer) => ({
    tokenId: transfer.token_id,
    account: transfer.account,
    amount: BigInt(transfer.amount)
  }))
});

const toCredit = (account: string, tokenId: string) => (transaction: MirrorTransaction) => {
  const moves = transaction.tokenTransfers.filter((transfer) => transfer.tokenId === tokenId);
  const amount = moves
    .filter((transfer) => transfer.account === account && transfer.amount > 0n)
    .reduce((sum, transfer) => sum + transfer.amount, 0n);
  const from = moves.filter((transfer) => transfer.amount < 0n).map((transfer) => transfer.account);
  return { ...transaction, amount, from };
};

export const createMirrorClient = (baseUrl: string, fetchImpl: FetchLike = fetch) => {
  const root = baseUrl.replace(/\/+$/, '');

  const getJson = async <T>(path: string, schema: z.ZodType<T>): Promise<MirrorResult<T>> => {
    let status: number;
    let body: unknown;
    try {
      const response = await fetchImpl(`${root}${path}`);
      status = response.status;
      if (!response.ok) {
        const reason = status === 404 ? 'not_found' : 'http_error';
        return { ok: false, data: { reason, status } };
      }
      body = await response.json();
    } catch {
      return { ok: false, data: { reason: 'http_error' } };
    }
    const parsed = schema.safeParse(body);
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, data: { reason: 'invalid_response', status } };
  };

  // The account's public key, for checking a payer's signature. A key list comes back as
  // ProtobufEncoded; Kosha's payers sign with a single key.
  const accountKey = async (accountId: string): Promise<MirrorResult<MirrorAccountKey>> => {
    const result = await getJson(`/api/v1/accounts/${accountId}`, accountSchema);
    if (!result.ok) return result;
    if (!result.data.key) return { ok: false, data: { reason: 'invalid_response' } };
    return { ok: true, data: { type: result.data.key._type, hex: result.data.key.key } };
  };

  // One token's balance on an account, or null when the account is not associated with it
  const tokenBalance = async (
    accountId: string,
    tokenId: string
  ): Promise<MirrorResult<bigint | null>> => {
    const path = `/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}`;
    const result = await getJson(path, accountTokensSchema);
    if (!result.ok) return result;
    const held = result.data.tokens.find((token) => token.token_id === tokenId);
    return { ok: true, data: held ? BigInt(held.balance) : null };
  };

  // The account memo; an agent's points at its HCS-11 profile (hcs11-profile.ts)
  const accountMemo = async (accountId: string): Promise<MirrorResult<string>> => {
    const result = await getJson(`/api/v1/accounts/${accountId}`, accountMemoSchema);
    return result.ok ? { ok: true, data: result.data.memo } : result;
  };

  // mirrorTransactionId is the 0.0.x-seconds-nanos form (see @kosha/shared/links)
  const transactionById = async (
    mirrorTransactionId: string
  ): Promise<MirrorResult<MirrorTransaction>> => {
    const path = `/api/v1/transactions/${mirrorTransactionId}`;
    const result = await getJson(path, transactionsPageSchema);
    if (!result.ok) return result;
    const [first] = result.data.transactions;
    if (!first) return { ok: false, data: { reason: 'not_found' } };
    return { ok: true, data: toTransaction(first) };
  };

  // The transaction that reached consensus at a timestamp, e.g. the transfer a schedule ran:
  // the schedule shows as executed even when that transfer failed, so its result is read here
  const transactionAt = async (
    consensusTimestamp: string
  ): Promise<MirrorResult<MirrorTransaction>> => {
    const path = `/api/v1/transactions?timestamp=${consensusTimestamp}`;
    const result = await getJson(path, transactionsPageSchema);
    if (!result.ok) return result;
    const [first] = result.data.transactions;
    if (!first) return { ok: false, data: { reason: 'not_found' } };
    return { ok: true, data: toTransaction(first) };
  };

  // Credits of one token to one account after the cursor (a consensus timestamp), oldest first,
  // across every page. The watcher stores the returned cursor and resumes from it.
  const tokenCreditsSince = async (
    account: string,
    tokenId: string,
    cursor: string
  ): Promise<MirrorResult<{ credits: TokenCredit[]; cursor: string }>> => {
    const credits: TokenCredit[] = [];
    let latest = cursor;
    let path: string | null =
      `/api/v1/transactions?account.id=${account}&transactiontype=CRYPTOTRANSFER` +
      `&timestamp=gt:${cursor}&order=asc&limit=${PAGE_LIMIT}`;

    while (path) {
      const page: MirrorResult<z.output<typeof transactionsPageSchema>> = await getJson(
        path,
        transactionsPageSchema
      );
      if (!page.ok) return page;
      for (const raw of page.data.transactions) {
        const credit = toCredit(account, tokenId)(toTransaction(raw));
        latest = credit.consensusTimestamp;
        if (credit.amount > 0n && credit.result === 'SUCCESS') {
          credits.push({
            transactionId: credit.transactionId,
            consensusTimestamp: credit.consensusTimestamp,
            memo: credit.memo,
            amount: credit.amount,
            from: credit.from
          });
        }
      }
      path = page.data.links?.next ?? null;
    }
    return { ok: true, data: { credits, cursor: latest } };
  };

  const scheduleStatus = async (scheduleId: string): Promise<MirrorResult<MirrorSchedule>> => {
    const result = await getJson(`/api/v1/schedules/${scheduleId}`, scheduleSchema);
    if (!result.ok) return result;
    const raw = result.data;
    const status = raw.executed_timestamp ? 'executed' : raw.deleted ? 'deleted' : 'pending';
    return {
      ok: true,
      data: {
        scheduleId: raw.schedule_id,
        status,
        executedAt: raw.executed_timestamp,
        expiresAt: raw.expiration_time,
        payerAccountId: raw.payer_account_id
      }
    };
  };

  // The HCS message a transaction posted, found by that transaction's consensus timestamp
  const topicMessageAt = async (
    consensusTimestamp: string
  ): Promise<MirrorResult<MirrorTopicMessage>> => {
    const path = `/api/v1/topics/messages/${consensusTimestamp}`;
    const result = await getJson(path, topicMessageSchema);
    if (!result.ok) return result;
    return {
      ok: true,
      data: { topicId: result.data.topic_id, sequence: result.data.sequence_number }
    };
  };

  return {
    accountKey,
    accountMemo,
    tokenBalance,
    transactionById,
    transactionAt,
    tokenCreditsSince,
    scheduleStatus,
    topicMessageAt
  };
};

export type MirrorClient = ReturnType<typeof createMirrorClient>;
