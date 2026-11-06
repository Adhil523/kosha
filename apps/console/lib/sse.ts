import type { StreamEvent } from '@kosha/shared/console-api';

export const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive'
} as const;

// A comment line: keeps proxies from closing an idle stream; EventSource ignores it
export const SSE_KEEPALIVE = ': keepalive\n\n';
export const SSE_KEEPALIVE_MS = 15_000;

export const sseEvent = (event: StreamEvent): string => `data: ${JSON.stringify(event)}\n\n`;
