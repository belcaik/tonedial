import Redis from 'ioredis';
import { env } from '../env.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

redis.on('error', (error) => {
  console.error('Redis error', error);
});

export async function acquireLock(key: string, ttlMs: number) {
  const acquired = await redis.set(key, '1', 'PX', ttlMs, 'NX');
  return acquired === 'OK';
}

export async function releaseLock(key: string) {
  await redis.del(key);
}
