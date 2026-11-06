import type { StreamEvent } from '@kosha/shared/console-api';
import { EventEmitter } from 'node:events';

export type StreamListener = (event: StreamEvent) => void;

// In-process fan-out of Console events, one channel per receiver. Core runs as one process, so
// nothing more is needed; a second instance would need a shared bus.
export type EventBus = {
  publish: (receiverId: string, event: StreamEvent) => void;
  // Returns the unsubscribe function
  subscribe: (receiverId: string, listener: StreamListener) => () => void;
};

export const createEventBus = (): EventBus => {
  const emitter = new EventEmitter();
  // One listener per open Console tab; the default cap of 10 would only warn
  emitter.setMaxListeners(0);
  return {
    publish: (receiverId, event) => {
      emitter.emit(receiverId, event);
    },
    subscribe: (receiverId, listener) => {
      emitter.on(receiverId, listener);
      return () => {
        emitter.off(receiverId, listener);
      };
    }
  };
};
