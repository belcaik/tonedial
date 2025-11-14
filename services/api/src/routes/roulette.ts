import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  createSessionSchema,
  rouletteCloseSchema,
  rouletteSessionSnapshotSchema,
  rouletteVoteSchema,
} from '@tonedial/shared';
import { createRouletteSession, getSessionCache, closeRouletteSession, submitVote } from '../services/roulette.js';
import { verifyActivityToken } from '../lib/jwt.js';
import { sessionHub } from '../lib/session-hub.js';

export async function registerRouletteRoutes(app: FastifyInstance) {
  app.post('/session', async (request, reply) => {
    const parseResult = createSessionSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid session payload', details: parseResult.error.flatten() });
    }

    try {
      request.log.debug({ payload: parseResult.data }, 'Validated roulette session payload');
      request.log.info({
        guildId: parseResult.data.rules.guildId,
        participants: parseResult.data.participants.length,
        voiceChannelId: parseResult.data.rules.voiceChannelId,
      }, 'Creating roulette session');
      const result = await createRouletteSession(parseResult.data);
      request.log.info({ sessionId: result.sessionId }, 'Roulette session created');
      return reply.send(result);
    } catch (error) {
      request.log.error(error, 'Failed to create roulette session');
      return reply.status(400).send({ error: (error as Error).message });
    }
  });

  app.post('/vote', async (request, reply) => {
      const parseResult = rouletteVoteSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({ error: 'Invalid vote payload' });
      }

      try {
        request.log.debug(parseResult.data, 'Vote payload accepted');
        request.log.debug(parseResult.data, 'Processing roulette vote');
        const outcome = await submitVote(parseResult.data);
        return reply.send(outcome);
      } catch (error) {
        request.log.warn(error, 'Vote rejected');
      return reply.status(400).send({ error: (error as Error).message });
    }
  });

  app.post('/close', async (request, reply) => {
    const parseResult = rouletteCloseSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid close payload' });
    }

    try {
      request.log.info({ ...parseResult.data }, 'Closing roulette session');
      const result = await closeRouletteSession(parseResult.data);
      return reply.send(result);
    } catch (error) {
      request.log.error(error, 'Failed to close roulette');
      return reply.status(400).send({ error: (error as Error).message });
    }
  });

  app.get('/session/:id', async (request, reply) => {
    const params = request.params as { id: string };
    try {
      const cache = await getSessionCache(params.id);
      if (!cache) {
        return reply.status(404).send({ error: 'Session not found or expired' });
      }
      const snapshot = rouletteSessionSnapshotSchema.parse({
        sessionId: cache.sessionId,
        deadline: new Date(cache.deadline).toISOString(),
        serverTime: new Date().toISOString(),
        ownerId: cache.rules.createdBy,
        pool: Object.values(cache.pool),
        rules: {
          guildId: cache.rules.guildId,
          textChannelId: cache.rules.textChannelId,
          voiceChannelId: cache.rules.voiceChannelId,
          maxProposals: cache.rules.maxProposals,
          timeSeconds: cache.rules.timeSeconds,
          ownershipMode: cache.rules.ownershipMode,
          poolMode: cache.rules.poolMode,
          minPlayers: cache.rules.minPlayers,
          ownershipThresholdPct: cache.rules.ownershipThresholdPct,
          baseWeight: cache.rules.baseWeight,
          voteWeightPct: cache.rules.voteWeightPct,
        },
      });
      return reply.send(snapshot);
    } catch (error) {
      request.log.error(error, 'Failed to hydrate session snapshot');
      return reply.status(500).send({ error: 'Failed to read session snapshot' });
    }
  });

  const streamHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { id: string };
    const token = extractBearerToken(request.headers.authorization) ?? (request.query as { token?: string } | undefined)?.token;
    if (!token) {
      return reply.status(401).send({ error: 'Missing activity token' });
    }

    try {
      const claims = verifyActivityToken(token);
      if (claims.sid !== params.id) {
        return reply.status(403).send({ error: 'Token does not match session' });
      }
      request.log.info({ sessionId: params.id, guildId: claims.gid }, 'SSE connection established');
    } catch (error) {
      return reply.status(401).send({ error: (error as Error).message });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    reply.raw.write('\n');

    sessionHub.addListener(params.id, reply);

    const cache = await getSessionCache(params.id);
    if (cache) {
      const snapshot = {
        sessionId: cache.sessionId,
        deadline: new Date(cache.deadline).toISOString(),
        serverTime: new Date().toISOString(),
        ownerId: cache.rules.createdBy,
        pool: Object.values(cache.pool),
        rules: {
          guildId: cache.rules.guildId,
          textChannelId: cache.rules.textChannelId,
          voiceChannelId: cache.rules.voiceChannelId,
          maxProposals: cache.rules.maxProposals,
          timeSeconds: cache.rules.timeSeconds,
          ownershipMode: cache.rules.ownershipMode,
          poolMode: cache.rules.poolMode,
          minPlayers: cache.rules.minPlayers,
          ownershipThresholdPct: cache.rules.ownershipThresholdPct,
          baseWeight: cache.rules.baseWeight,
          voteWeightPct: cache.rules.voteWeightPct,
        },
      };
      reply.raw.write(`event: session.created\ndata: ${JSON.stringify(snapshot)}\n\n`);
    }

    request.raw.on('close', () => {
      request.log.info({ sessionId: params.id }, 'SSE connection closed');
    });

    return reply.raw;
  };

  app.get('/session/:id/events', streamHandler);
  app.get('/:id/stream', streamHandler);
}

function extractBearerToken(header?: string) {
  if (!header) {
    return null;
  }
  const [type, value] = header.split(' ');
  if (!type || type.toLowerCase() !== 'bearer') {
    return null;
  }
  return value || null;
}
