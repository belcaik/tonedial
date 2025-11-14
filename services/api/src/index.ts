import Fastify, { type FastifyServerOptions } from 'fastify';
import { readFileSync } from 'node:fs';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import formbody from '@fastify/formbody';
import { env } from './env.js';
import { ensureBaseSchema } from './db/bootstrap.js';
import { registerSteamRoutes } from './routes/steam.js';
import { registerRouletteRoutes } from './routes/roulette.js';
import { registerActivityRoutes } from './routes/activity.js';

function resolveHttpsOptions() {
  if (!env.API_ENABLE_HTTPS) {
    return undefined;
  }

  try {
    return {
      cert: readFileSync(env.API_TLS_CERT_PATH!, 'utf8'),
      key: readFileSync(env.API_TLS_KEY_PATH!, 'utf8'),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load TLS certificates: ${reason}`);
  }
}

export async function buildServer() {
  const httpsOptions = resolveHttpsOptions();
  const logger = { level: env.NODE_ENV === 'production' ? 'info' : 'debug' };
  const serverOptions: FastifyServerOptions = { logger };
  if (httpsOptions) {
    (serverOptions as FastifyServerOptions & { https: typeof httpsOptions }).https = httpsOptions;
  }

  const server = Fastify(serverOptions);

  await ensureBaseSchema();

  await server.register(cors, {
    origin: true,
    credentials: true,
  });

  await server.register(formbody);

  await server.register(rateLimit, {
    max: 30,
    timeWindow: '1 minute',
  });

  await server.register(registerSteamRoutes);
  await server.register(registerRouletteRoutes, { prefix: '/roulette' });
  await server.register(registerActivityRoutes);

  server.get('/health', async () => ({ status: 'ok', service: 'api' }));
  server.get('/docs', async () => ({
    name: 'ToneDial API',
    version: '0.1.0',
    endpoints: [
      { method: 'POST', path: '/auth/steam/callback', description: 'Steam OpenID callback' },
      { method: 'GET', path: '/steam/owned/:steamid', description: 'Owned games with caching' },
      { method: 'GET', path: '/games/:appid', description: 'Steam metadata cache' },
      { method: 'POST', path: '/roulette/session', description: 'Create roulette session' },
      { method: 'POST', path: '/roulette/vote', description: 'Submit roulette vote' },
      { method: 'POST', path: '/roulette/close', description: 'Close or reroll roulette session' },
      { method: 'GET', path: '/roulette/session/:id', description: 'Fetch roulette snapshot' },
      { method: 'GET', path: '/roulette/session/:id/events', description: 'SSE stream for Activity UI' },
    ],
  }));

  return server;
}

async function start() {
  const server = await buildServer();
  try {
    await server.listen({ port: env.API_PORT, host: '0.0.0.0' });
    server.log.info(`API listening on port ${env.API_PORT}`);
  } catch (error) {
    server.log.error(error, 'Failed to start server');
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/dist/index.js')) {
  start();
}
