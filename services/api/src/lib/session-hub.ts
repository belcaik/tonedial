import type { FastifyReply } from 'fastify';
import type { SessionEventType } from '@tonedial/shared';

class SessionHub {
  private listeners = new Map<string, Set<FastifyReply>>();

  addListener(sessionId: string, reply: FastifyReply) {
    const set = this.listeners.get(sessionId) ?? new Set();
    set.add(reply);
    this.listeners.set(sessionId, set);

    reply.raw.on('close', () => {
      set.delete(reply);
      if (set.size === 0) {
        this.listeners.delete(sessionId);
      }
    });
  }

  emit(sessionId: string, type: SessionEventType, payload: unknown) {
    const listeners = this.listeners.get(sessionId);
    if (!listeners || !listeners.size) {
      return;
    }

    const frame = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const reply of listeners) {
      reply.raw.write(frame);
    }
  }
}

export const sessionHub = new SessionHub();
