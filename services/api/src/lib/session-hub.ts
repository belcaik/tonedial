import type { FastifyReply } from 'fastify';
import type { RouletteSessionEvent } from '@tonedial/shared';

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

  emit(sessionId: string, event: RouletteSessionEvent) {
    const listeners = this.listeners.get(sessionId);
    if (!listeners || !listeners.size) {
      return;
    }

    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const reply of listeners) {
      reply.raw.write(payload);
    }
  }
}

export const sessionHub = new SessionHub();
