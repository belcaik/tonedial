import jwt from 'jsonwebtoken';
import { activityAuthSchema, type ActivityAuthClaims } from '@tonedial/shared';
import { env } from '../env.js';

const DEFAULT_TTL_SECONDS = 10 * 60;

export function signActivityToken(sessionId: string, guildId: string, ttlSeconds = DEFAULT_TTL_SECONDS) {
  return jwt.sign({ sessionId, guildId }, env.API_JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: ttlSeconds,
  });
}

export function verifyActivityToken(token: string): ActivityAuthClaims {
  const decoded = jwt.verify(token, env.API_JWT_SECRET, {
    algorithms: ['HS256'],
  });

  const result = activityAuthSchema.safeParse(decoded);
  if (!result.success) {
    throw new Error('Invalid activity token payload');
  }

  return result.data;
}
