import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { ensureGamesMetadata } from '../lib/games.js';
import { getOwnedGames, verifySteamOpenId } from '../lib/steam.js';

const steamCallbackQuery = z.object({ state: z.string().min(2) });

export async function registerSteamRoutes(app: FastifyInstance) {
  const steamCallbackHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const queryParse = steamCallbackQuery.safeParse(request.query);
    if (!queryParse.success) {
      return reply.status(400).send({ error: 'Missing or invalid state parameter.' });
    }

    const payloadSource =
      request.method === 'POST'
        ? ((request.body ?? {}) as Record<string, string | string[]>)
        : ((request.query ?? {}) as Record<string, string | string[]>);

    try {
      const steamId64 = await verifySteamOpenId(payloadSource);
      const owned = await getOwnedGames(steamId64, true);

      await db
        .insert(schema.users)
        .values({ idDiscord: queryParse.data.state })
        .onConflictDoNothing();

      await db
        .insert(schema.steamLinks)
        .values({
          userId: queryParse.data.state,
          steamId64,
          visibilityOk: owned.visibilityOk,
        })
        .onConflictDoUpdate({
          target: schema.steamLinks.userId,
          set: { steamId64, visibilityOk: owned.visibilityOk, linkedAt: new Date() },
        });

      return reply.send({
        steamId64,
        visibilityOk: owned.visibilityOk,
        totalGames: owned.games.length,
      });
    } catch (error) {
      request.log.error(error, 'Failed to process Steam callback');
      return reply.status(400).send({ error: (error as Error).message });
    }
  };

  app.post('/auth/steam/callback', steamCallbackHandler);
  app.get('/auth/steam/callback', steamCallbackHandler);

  const ownedQuerySchema = z.object({ force: z.coerce.boolean().optional() });

  app.get('/steam/owned/:steamid', async (request, reply) => {
    const params = request.params as { steamid: string };
    const query = ownedQuerySchema.safeParse(request.query ?? {});
    if (!query.success) {
      return reply.status(400).send({ error: 'Invalid query parameters' });
    }
    const force = query.data.force ?? false;

    try {
      const data = await getOwnedGames(params.steamid, force);
      return reply.send(data);
    } catch (error) {
      request.log.error(error, 'Failed to fetch owned games');
      return reply.status(400).send({ error: (error as Error).message });
    }
  });

  app.get('/games/:appid', async (request, reply) => {
    const params = request.params as { appid: string };
    const appIdNumber = Number(params.appid);
    if (Number.isNaN(appIdNumber)) {
      return reply.status(400).send({ error: 'appid must be numeric' });
    }

    try {
      const metadataMap = await ensureGamesMetadata([appIdNumber]);
      const metadata = metadataMap.get(appIdNumber);
      if (!metadata) {
        return reply.status(404).send({ error: 'Game metadata not found' });
      }
      return reply.send(metadata);
    } catch (error) {
      request.log.error(error, 'Failed to load game metadata');
      return reply.status(500).send({ error: 'Failed to load metadata' });
    }
  });
}
