import {
  createGateHandler,
  type GateOptions,
  type GateResult,
  type KoshaContext,
  type SettledResult
} from './gate-handler';
import { type Request, type RequestHandler, type Response } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express types req through this global namespace
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration merging needs an interface
    interface Request {
      // Set once the payment has settled, before the handler runs (settleMode "before")
      kosha?: KoshaContext;
    }
  }
}

export type SettleMode = 'before' | 'after';

export type KoshaGateOptions = GateOptions & {
  // "before" (the default) settles before the handler runs, so data is never served unpaid.
  // "after" verifies first, runs the handler, and settles only if it answered 2xx.
  settleMode?: SettleMode;
  onSettled?: (kosha: KoshaContext) => void;
};

type Respond = Extract<GateResult, { action: 'respond' }>;
type Callback = (error?: Error | null) => void;

const isSuccess = (status: number): boolean => status >= 200 && status < 300;

// The headers that described the handler's own body, dropped when a failure replaces it
const BODY_HEADERS = ['content-length', 'content-type', 'etag'] as const;

const send = (res: Response, result: Respond): void => {
  res.status(result.status).set(result.headers);
  if (result.body === null) {
    res.end();
    return;
  }
  res.json(result.body);
};

const toGateRequest = (req: Request) => ({
  method: req.method,
  url: `${req.protocol}://${req.get('host') ?? 'localhost'}${req.originalUrl}`,
  headers: req.headers
});

const notify = (onSettled: KoshaGateOptions['onSettled'], kosha: KoshaContext): void => {
  try {
    onSettled?.(kosha);
  } catch (error) {
    console.error('[kosha-gate]: onSettled threw', error);
  }
};

const toBuffer = (chunk: unknown, encoding: unknown): Buffer | null => {
  if (typeof chunk === 'string') {
    return Buffer.from(chunk, typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8');
  }
  return chunk instanceof Uint8Array ? Buffer.from(chunk) : null;
};

const lastCallback = (...args: unknown[]): Callback | undefined =>
  args.find((arg): arg is Callback => typeof arg === 'function');

// Holds everything the handler writes, then hands the whole body to `release` when it ends.
// The response stays unsent, so a failed settlement can still replace it with a 402.
const holdResponse = (res: Response, release: (body: Buffer) => Promise<void>): void => {
  const chunks: Buffer[] = [];
  const write = res.write;
  const end = res.end;

  res.write = ((chunk: unknown, encoding?: unknown, callback?: unknown) => {
    const buffer = toBuffer(chunk, encoding);
    if (buffer) {
      chunks.push(buffer);
    }
    const done = lastCallback(encoding, callback);
    if (done) {
      queueMicrotask(() => done());
    }
    return true;
  }) as Response['write'];

  res.end = ((chunk?: unknown, encoding?: unknown, callback?: unknown) => {
    const buffer = toBuffer(chunk, encoding);
    if (buffer) {
      chunks.push(buffer);
    }
    const done = lastCallback(chunk, encoding, callback);
    if (done) {
      res.once('finish', done);
    }
    res.write = write;
    res.end = end;
    void release(Buffer.concat(chunks));
    return res;
  }) as Response['end'];
};

const settleAfter = (
  req: Request,
  res: Response,
  settle: () => Promise<SettledResult>,
  onSettled: KoshaGateOptions['onSettled']
): void => {
  holdResponse(res, async (body) => {
    // The agent is charged only for a call that worked
    if (!isSuccess(res.statusCode)) {
      res.end(body);
      return;
    }
    let settled: SettledResult;
    try {
      settled = await settle();
    } catch (error) {
      console.error('[kosha-gate]: settlement threw', error);
      settled = {
        action: 'respond',
        status: 503,
        headers: {},
        body: { error: 'core_unavailable' }
      };
    }
    // A handler that flushed its own headers can't be replaced; it has served the data either way
    if (res.headersSent) {
      res.end(body);
      return;
    }
    if (settled.action === 'respond') {
      BODY_HEADERS.forEach((name) => res.removeHeader(name));
      send(res, settled);
      return;
    }
    req.kosha = settled.kosha;
    notify(onSettled, settled.kosha);
    res.set(settled.headers).end(body);
  });
};

// Express middleware: quotes unpaid requests to priced routes, and lets paid ones through
// once Core has verified and settled them. Unpriced routes pass straight to the next handler.
export const koshaGate = (options: KoshaGateOptions): RequestHandler => {
  const { settleMode = 'before', onSettled, ...gateOptions } = options;
  const handle = createGateHandler(gateOptions);
  const deferSettle = settleMode === 'after';

  return async (req, res, next) => {
    const result = await handle(toGateRequest(req), { deferSettle });
    switch (result.action) {
      case 'next':
        next();
        return;
      case 'respond':
        send(res, result);
        return;
      case 'pass':
        req.kosha = result.kosha;
        notify(onSettled, result.kosha);
        res.set(result.headers);
        next();
        return;
      case 'verified':
        settleAfter(req, res, result.settle, onSettled);
        next();
        return;
    }
  };
};
