import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { ensureGamesMetadata } from '../lib/games.js';
import { getOwnedGames, verifySteamOpenId } from '../lib/steam.js';
import { steamLinkStatusSchema } from '@tonedial/shared';

const steamCallbackQuery = z.object({ state: z.string().min(2) });

const linkStatusParams = z.object({ userId: z.string().min(2).max(32) });

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

      const payload = {
        linked: true,
        userId: queryParse.data.state,
        steamId64,
        visibilityOk: owned.visibilityOk,
        linkedAt: new Date().toISOString(),
        totalGames: owned.games.length,
        cacheRefreshedAt: owned.fetchedAt,
      } as const;

      if (wantsHtmlResponse(request)) {
        return reply.type('text/html').send(renderSteamLinkPage({
          success: true,
          steamId64,
          totalGames: owned.games.length,
        }));
      }

      return reply.send(payload);
    } catch (error) {
      request.log.error(error, 'Failed to process Steam callback');
      if (wantsHtmlResponse(request)) {
        return reply
          .type('text/html')
          .status(400)
          .send(renderSteamLinkPage({ success: false, message: (error as Error).message }));
      }
      return reply.status(400).send({ error: (error as Error).message });
    }
  };

  app.post('/auth/steam/callback', steamCallbackHandler);
  app.get('/auth/steam/callback', steamCallbackHandler);

  app.get('/steam/link/:userId', async (request, reply) => {
    const paramsParse = linkStatusParams.safeParse(request.params ?? {});
    if (!paramsParse.success) {
      return reply.status(400).send({ error: 'Invalid user id parameter' });
    }

    const row = await db
      .select({
        userId: schema.steamLinks.userId,
        steamId64: schema.steamLinks.steamId64,
        visibilityOk: schema.steamLinks.visibilityOk,
        linkedAt: schema.steamLinks.linkedAt,
      })
      .from(schema.steamLinks)
      .where(eq(schema.steamLinks.userId, paramsParse.data.userId))
      .limit(1);

    if (!row.length) {
      return reply.send(steamLinkStatusSchema.parse({ linked: false, userId: paramsParse.data.userId }));
    }

    const entry = row[0];
    if (!entry) {
      return reply.send(steamLinkStatusSchema.parse({ linked: false, userId: paramsParse.data.userId }));
    }

    let ownedSummary: { totalGames?: number; fetchedAt?: string } = {};
    try {
      const owned = await getOwnedGames(entry.steamId64);
      ownedSummary = { totalGames: owned.games.length, fetchedAt: owned.fetchedAt };
    } catch (error) {
      request.log.warn(error, 'Failed to fetch owned games snapshot for link status');
    }

    return reply.send(
      steamLinkStatusSchema.parse({
        linked: true,
        userId: entry.userId,
        steamId64: entry.steamId64,
        visibilityOk: entry.visibilityOk,
        linkedAt: entry.linkedAt?.toISOString(),
        totalGames: ownedSummary.totalGames,
        cacheRefreshedAt: ownedSummary.fetchedAt,
      }),
    );
  });

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

function wantsHtmlResponse(request: FastifyRequest) {
  const acceptHeader = (request.headers.accept ?? '').toLowerCase();
  if (acceptHeader.includes('application/json')) {
    return false;
  }
  if (acceptHeader.includes('text/html')) {
    return true;
  }
  return true;
}

function renderSteamLinkPage(params: { success: boolean; steamId64?: string; totalGames?: number; message?: string }) {
  const { success, steamId64, totalGames, message } = params;
  const title = success ? 'Steam account linked' : 'Steam linking failed';
  const statusColor = success ? '#2ecc71' : '#e74c3c';
  const bodyMessage = success
    ? `Steam ID <strong>${steamId64 ?? ''}</strong> is now linked. Cached library contains <strong>${
        typeof totalGames === 'number' ? totalGames : 'your'
      }</strong> games.`
    : message ?? 'Something went wrong while linking your Steam account.';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body { font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif; padding: 2rem; background: #0f172a; color: #f8fafc; }
      .card { max-width: 520px; margin: 0 auto; background: #111827; border-radius: 16px; padding: 2rem; box-shadow: 0 10px 40px rgba(15, 23, 42, 0.5); }
      h1 { margin-top: 0; color: ${statusColor}; }
      p { line-height: 1.6; }
      .hint { margin-top: 1.5rem; opacity: 0.8; font-size: 0.95rem; }
      a { color: #60a5fa; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${title}</h1>
      <p>${bodyMessage}</p>
      <p class="hint">You can close this tab and return to Discord. Run <code>/roulette start</code> once everyone has linked their Steam account.</p>
    </div>
  </body>
</html>`;
}
