import jwt from 'jsonwebtoken';
import { activityAuthSchema, type ActivityAuthClaims } from '@tonedial/shared';
import { env } from '../env.js';

const DEFAULT_TTL_SECONDS = 10 * 60;

export type ActivityTokenOptions = {
  sessionId: string;
  guildId: string;
  textChannelId: string;
  voiceChannelId: string;
  userId?: string;
  audience?: string;
  issuer?: string;
  ttlSeconds?: number;
};

export function signActivityToken(options: ActivityTokenOptions) {
  const payload: Record<string, string> = {
    sid: options.sessionId,
    gid: options.guildId,
    cid: options.textChannelId,
    vcid: options.voiceChannelId,
  };

  if (options.userId) {
    payload.sub = options.userId;
  }
  if (options.audience) {
    payload.aud = options.audience;
  }
  if (options.issuer) {
    payload.iss = options.issuer;
  }

  const token = jwt.sign(payload, env.API_JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: options.ttlSeconds ?? DEFAULT_TTL_SECONDS,
  });

  const decoded = jwt.decode(token) as { exp?: number } | null;

  return { token, exp: decoded?.exp ?? 0 };
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
