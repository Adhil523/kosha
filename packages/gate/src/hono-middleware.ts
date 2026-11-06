import { type AdapterOptions, isSuccess, notifySettled } from './adapter-options';
import {
  createGateHandler,
  type GateResult,
  type KoshaContext,
  type SettledResult
} from './gate-handler';
import { type Context } from 'hono';
import { createMiddleware } from 'hono/factory';

// Declare it on your app to read the settled payment: `new Hono<KoshaHonoEnv>()`, then
// `c.get('kosha')` in a handler (settleMode "before")
export type KoshaHonoEnv = { Variables: { kosha: KoshaContext } };
export type KoshaHonoOptions = AdapterOptions;

type Respond = Extract<GateResult, { action: 'respond' }>;

const CORE_UNAVAILABLE: Respond = {
  action: 'respond',
  status: 503,
  headers: {},
  body: { error: 'core_unavailable' }
};

const toResponse = ({ status, headers, body }: Respond): Response =>
  body === null
    ? new Response(null, { status, headers })
    : Response.json(body, { status, headers });

// The handler's response may be immutable (e.g. a fetch passthrough), so copy it before adding
const withHeaders = (c: Context, headers: Record<string, string>): void => {
  c.res = new Response(c.res.body, c.res);
  for (const [name, value] of Object.entries(headers)) c.res.headers.set(name, value);
};

const settle = async (run: () => Promise<SettledResult>): Promise<SettledResult> => {
  try {
    return await run();
  } catch (error) {
    console.error('[kosha-gate]: settlement threw', error);
    return CORE_UNAVAILABLE;
  }
};

// Hono middleware, the same contract as koshaGate() for Express: quotes unpaid requests to priced
// routes and lets paid ones through once Core has verified and settled them. Runs anywhere Hono
// does (Node, Bun, Deno, Workers): it needs only fetch.
export const koshaHono = (options: KoshaHonoOptions) => {
  const { settleMode = 'before', onSettled, ...gateOptions } = options;
  const handle = createGateHandler(gateOptions);
  const deferSettle = settleMode === 'after';

  return createMiddleware<KoshaHonoEnv>(async (c, next) => {
    const request = {
      method: c.req.method,
      url: c.req.url,
      headers: Object.fromEntries(c.req.raw.headers)
    };
    const result = await handle(request, { deferSettle });
    switch (result.action) {
      case 'next':
        await next();
        return;
      case 'respond':
        return toResponse(result);
      case 'pass':
        c.set('kosha', result.kosha);
        notifySettled(onSettled, result.kosha);
        await next();
        withHeaders(c, result.headers);
        return;
      case 'verified': {
        await next();
        // The agent is charged only for a call that worked
        if (!isSuccess(c.res.status)) return;
        const settled = await settle(result.settle);
        if (settled.action === 'respond') {
          c.res = toResponse(settled);
          return;
        }
        c.set('kosha', settled.kosha);
        notifySettled(onSettled, settled.kosha);
        withHeaders(c, settled.headers);
        return;
      }
    }
  });
};
