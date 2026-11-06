import 'server-only';
import { SSE_KEEPALIVE, SSE_KEEPALIVE_MS, sseEvent } from '@/lib/sse';
import { STREAM_EVENTS_FIXTURE } from '@kosha/shared/fixtures';

const FIXTURE_EVENT_GAP_MS = 2_000;

// KOSHA_MOCK=1: replays the fixture events, then keeps the connection alive like Core does
export const mockEventStream = (signal: AbortSignal): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  const timers: ReturnType<typeof setTimeout>[] = [];

  return new ReadableStream({
    start: (controller) => {
      const send = (text: string) => {
        if (!signal.aborted) controller.enqueue(encoder.encode(text));
      };
      STREAM_EVENTS_FIXTURE.forEach((event, index) => {
        timers.push(setTimeout(() => send(sseEvent(event)), (index + 1) * FIXTURE_EVENT_GAP_MS));
      });
      const keepalive = setInterval(() => send(SSE_KEEPALIVE), SSE_KEEPALIVE_MS);
      signal.addEventListener('abort', () => {
        timers.forEach(clearTimeout);
        clearInterval(keepalive);
        try {
          controller.close();
        } catch {
          // already closed by the runtime when the client went away
        }
      });
    }
  });
};
