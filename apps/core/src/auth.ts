import type { KoshaDb } from './db/client';
import { receiver } from './db/schema';
import type { ErrorResponse } from '@kosha/shared/error-codes';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// Two callers: the Console and scripts use CONSOLE_ADMIN_TOKEN, and each API owner's Gate uses its
// receiver API key. Both arrive as `Authorization: Bearer <secret>`.

const API_KEY_BYTES = 32;
const BEARER_PATTERN = /^Bearer (\S+)$/;

export const generateApiKey = (): string => randomBytes(API_KEY_BYTES).toString('hex');

// Keys are stored only as this hash; a leaked database row can't be used to call Core
export const hashApiKey = (apiKey: string): string =>
  createHash('sha256').update(apiKey).digest('hex');

const bearerToken = (request: Pick<FastifyRequest, 'headers'>): string | null =>
  BEARER_PATTERN.exec(request.headers.authorization ?? '')?.[1] ?? null;

const sameSecret = (given: string, expected: string): boolean => {
  const left = Buffer.from(hashApiKey(given));
  const right = Buffer.from(hashApiKey(expected));
  return timingSafeEqual(left, right);
};

const UNAUTHORIZED: ErrorResponse = { error: 'unauthorized' };

// preHandler for admin routes
export const requireAdmin =
  (adminToken: string) => async (request: FastifyRequest, reply: FastifyReply) => {
    const token = bearerToken(request);
    if (!token || !sameSecret(token, adminToken)) {
      return reply.status(401).send(UNAUTHORIZED);
    }
  };

export type ReceiverRow = typeof receiver.$inferSelect;

export type AuthenticatedReceiver =
  { ok: true; data: ReceiverRow } | { ok: false; data: ErrorResponse };

// The single place a request is tied to a receiver. Receiver-facing handlers call this first and
// scope every query to the receiver it returns.
export const authenticateReceiver = async (
  db: KoshaDb,
  request: Pick<FastifyRequest, 'headers'>
): Promise<AuthenticatedReceiver> => {
  const apiKey = bearerToken(request);
  if (!apiKey) return { ok: false, data: UNAUTHORIZED };
  const [row] = await db
    .select()
    .from(receiver)
    .where(eq(receiver.apiKeyHash, hashApiKey(apiKey)));
  return row ? { ok: true, data: row } : { ok: false, data: UNAUTHORIZED };
};

// Who may read a receiver's ledger: the admin (any receiver, `receiverId: null`) or the receiver
// itself (only its own rows)
export type ReaderScope =
  { ok: true; data: { receiverId: string | null } } | { ok: false; data: ErrorResponse };

export const authenticateReader = async (
  db: KoshaDb,
  adminToken: string,
  request: Pick<FastifyRequest, 'headers'>
): Promise<ReaderScope> => {
  const token = bearerToken(request);
  if (token && sameSecret(token, adminToken)) return { ok: true, data: { receiverId: null } };
  const receiverAuth = await authenticateReceiver(db, request);
  return receiverAuth.ok ? { ok: true, data: { receiverId: receiverAuth.data.id } } : receiverAuth;
};

// The receiver a read is for: a receiver key reads only its own; the admin names one, or none.
// Null means the scope and the request disagree.
export const scopedReceiver = (
  scope: { receiverId: string | null },
  requested: string | undefined
): { receiverId: string | undefined } | null => {
  if (scope.receiverId === null) return { receiverId: requested };
  if (requested && requested !== scope.receiverId) return null;
  return { receiverId: scope.receiverId };
};
