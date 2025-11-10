import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { signActivityToken } from '../lib/jwt.js';

const sessionTokenSchema = z.object({
  sessionId: z.string(),
  userId: z.string().optional(),
});

export async function registerActivityRoutes(app: FastifyInstance) {
  app.post('/activity/session-token', async (request, reply) => {
    const parse = sessionTokenSchema.safeParse(request.body ?? {});
    if (!parse.success) {
      return reply.status(400).send({ error: 'Invalid session token payload' });
    }

    const session = await db
      .select({
        id: schema.rouletteSessions.id,
        guildId: schema.rouletteSessions.guildId,
        textChannelId: schema.rouletteSessions.textChannelId,
        voiceChannelId: schema.rouletteSessions.voiceChannelId,
        state: schema.rouletteSessions.state,
      })
      .from(schema.rouletteSessions)
      .where(eq(schema.rouletteSessions.id, parse.data.sessionId))
      .limit(1);

    const record = session[0];
    if (!record) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    if (record.state !== 'collecting' && record.state !== 'pending') {
      return reply.status(409).send({ error: 'Session no longer accepts Activity connections' });
    }

    const tokenPayload = {
      sessionId: record.id,
      guildId: record.guildId,
      textChannelId: record.textChannelId,
      voiceChannelId: record.voiceChannelId,
      ...(parse.data.userId ? { userId: parse.data.userId } : {}),
    } as const;

    const { token, exp } = signActivityToken(tokenPayload);

    return reply.send({ token, exp });
  });
}
