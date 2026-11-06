import { isMockMode, openCoreStream } from '@/lib/core.server';
import { mockEventStream } from '@/lib/mock-stream.server';
import { RECEIVER_VIEWERS, requireWorkspace } from '@/lib/route-guard.server';
import { SSE_HEADERS } from '@/lib/sse';

// Proxies Core's server-sent events, so the browser never holds Core credentials. When the
// stream is unavailable the browser falls back to polling /api/ledger.
export const GET = async (request: Request) => {
  const denied = await requireWorkspace(RECEIVER_VIEWERS);
  if (denied) return denied;
  if (isMockMode()) return new Response(mockEventStream(request.signal), { headers: SSE_HEADERS });

  const upstream = await openCoreStream(request.signal);
  if (!upstream.ok) return Response.json(upstream.data, { status: upstream.status || 502 });
  return new Response(upstream.data, { headers: SSE_HEADERS });
};
