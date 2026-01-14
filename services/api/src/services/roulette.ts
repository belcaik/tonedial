import { randomUUID } from 'node:crypto';
import {
  buildAliasTable,
  createSessionSchema,
  rouletteCloseSchema,
  rouletteVoteSchema,
  sampleAlias,
  type CreateSessionPayload,
  type RouletteClosePayload,
  type RouletteGameCandidate,
  type RouletteResult,
  type RouletteVotePayload,
} from '@tonedial/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { ensureGamesMetadata } from '../lib/games.js';
import { acquireLock, redis, releaseLock } from '../lib/redis.js';
import { getOwnedGames } from '../lib/steam.js';
import { signActivityToken } from '../lib/jwt.js';
import { sessionHub } from '../lib/session-hub.js';
import { clearSessionClock, scheduleSessionClock } from './session-clock.js';

const SESSION_CACHE_PREFIX = 'roulette:session:';
const SESSION_CACHE_TTL_SECONDS = 60 * 60 * 4; // 4 hours

export type SessionCache = {
  sessionId: string;
  guildId: string;
  deadline: number;
  rules: CreateSessionPayload['rules'];
  pool: Record<string, RouletteGameCandidate>;
  participants: { userId: string; steamId64: string }[];
};

export async function createRouletteSession(payload: CreateSessionPayload) {
  const data = createSessionSchema.parse(payload);
  const lockKey = getGuildLockKey(data.rules.guildId);
  const lockMs = (data.rules.timeSeconds + 10) * 1000;
  const acquired = await acquireLock(lockKey, lockMs);

  if (!acquired) {
    throw new Error('A roulette session is already running for this guild.');
  }

  try {
    await upsertUsers(data.participants.map((participant) => participant.userId));
    const steamLinks = await loadSteamLinks(data.participants.map((p) => p.userId));

    const missing = data.participants.filter((participant) => !steamLinks.has(participant.userId));
    if (missing.length) {
      throw new Error(
        `Steam link missing for: ${missing.map((entry) => entry.userId).join(', ') || 'unknown users'}`,
      );
    }

    const linkRecords = Array.from(steamLinks.values());
    const invalidPrivacy = linkRecords.filter((link) => !link.visibilityOk);
    if (invalidPrivacy.length) {
      throw new Error(
        `Game visibility must be public for: ${invalidPrivacy.map((entry) => entry.userId).join(', ')}`,
      );
    }

    const ownershipMap = await buildOwnershipMap(linkRecords);
    const participantCount = data.participants.length;
    const poolEntries = Array.from(ownershipMap.values()).filter((candidate) =>
      filterByPool(candidate, data.rules.poolMode, participantCount),
    );

    const ownershipThreshold =
      data.rules.ownershipMode === 'threshold' ? data.rules.ownershipThresholdPct ?? 1 : 1;

    const ownershipFiltered = poolEntries.filter((candidate) =>
      filterByOwnership(candidate, data.rules.ownershipMode, ownershipThreshold, participantCount),
    );

    const metadataMap = await ensureGamesMetadata(ownershipFiltered.map((entry) => entry.appId));

    console.log('[Roulette Debug] owned games metadata filtering candidates:', {
      totalCandidates: ownershipFiltered.length,
      candidateAppIds: ownershipFiltered.map((c) => c.appId),
      metadataFetched: metadataMap.size,
      metadataEntries: Array.from(metadataMap.entries()).map(([appId, meta]) => ({
        appId,
        name: meta.name,
        isMultiplayer: meta.isMultiplayer,
        maxPlayers: meta.maxPlayers,
      })),
      minPlayersRequired: data.rules.minPlayers,
    });

    const finalCandidates: RouletteGameCandidate[] = [];
    for (const candidate of ownershipFiltered) {
      const metadata = metadataMap.get(candidate.appId);
      if (metadata && !metadata.isMultiplayer) {
        continue;
      }
      if (
        data.rules.minPlayers &&
        metadata?.maxPlayers &&
        metadata.maxPlayers < data.rules.minPlayers
      ) {
        continue;
      }

      finalCandidates.push({
        appId: candidate.appId,
        name: metadata?.name ?? candidate.name,
        owners: Array.from(candidate.owners),
        isMultiplayer: metadata?.isMultiplayer ?? true,
        maxPlayers: metadata?.maxPlayers,
        weight: data.rules.baseWeight,
        votes: [],
      });
    }

    if (!finalCandidates.length) {
      throw new Error('No multiplayer games matched the current roulette rules.');
    }

    const sessionId = randomUUID();
    const now = new Date();
    const deadlineMs = now.getTime() + data.rules.timeSeconds * 1000;

    await db.insert(schema.rouletteSessions).values({
      id: sessionId,
      guildId: data.rules.guildId,
      textChannelId: data.rules.textChannelId,
      voiceChannelId: data.rules.voiceChannelId,
      createdBy: data.rules.createdBy,
      state: 'collecting',
      maxProposals: data.rules.maxProposals,
      timeSeconds: data.rules.timeSeconds,
      ownershipMode: data.rules.ownershipMode,
      poolMode: data.rules.poolMode,
      minPlayers: data.rules.minPlayers ?? null,
      ownershipThresholdPct: data.rules.ownershipThresholdPct ?? null,
      baseWeight: data.rules.baseWeight,
      voteWeightPct: data.rules.voteWeightPct,
      startedAt: now,
    });

    await db
      .insert(schema.rouletteParticipants)
      .values(data.participants.map((participant) => ({ sessionId, userId: participant.userId })));

    const sessionCache: SessionCache = {
      sessionId,
      guildId: data.rules.guildId,
      deadline: deadlineMs,
      rules: data.rules,
      pool: finalCandidates.reduce<Record<string, RouletteGameCandidate>>((acc, candidate) => {
        acc[String(candidate.appId)] = candidate;
        return acc;
      }, {}),
      participants: linkRecords.map((link) => ({ userId: link.userId, steamId64: link.steamId64 })),
    };

    await saveSessionCache(sessionCache);

    const { token, exp } = signActivityToken({
      sessionId,
      guildId: data.rules.guildId,
      textChannelId: data.rules.textChannelId,
      voiceChannelId: data.rules.voiceChannelId,
      userId: data.rules.createdBy,
    });

    const snapshotPayload = {
      sessionId,
      deadline: new Date(deadlineMs).toISOString(),
      serverTime: new Date().toISOString(),
      ownerId: data.rules.createdBy,
      pool: Object.values(sessionCache.pool),
      rules: {
        guildId: data.rules.guildId,
        textChannelId: data.rules.textChannelId,
        voiceChannelId: data.rules.voiceChannelId,
        maxProposals: data.rules.maxProposals,
        timeSeconds: data.rules.timeSeconds,
        ownershipMode: data.rules.ownershipMode,
        poolMode: data.rules.poolMode,
        minPlayers: data.rules.minPlayers,
        ownershipThresholdPct: data.rules.ownershipThresholdPct,
        baseWeight: data.rules.baseWeight,
        voteWeightPct: data.rules.voteWeightPct,
      },
    };

    sessionHub.emit(sessionId, 'session.created', snapshotPayload);

    scheduleSessionClock(
      sessionId,
      deadlineMs,
      (remainingSeconds) => {
        sessionHub.emit(sessionId, 'session.tick', {
          sessionId,
          remainingSeconds,
          serverTime: new Date().toISOString(),
        });
      },
      () => {
        closeRouletteSession({ sessionId, requestedBy: data.rules.createdBy, action: 'close' }).catch((error) => {
          console.error('Failed to auto-close roulette session', sessionId, error);
        });
      },
    );

    return {
      sessionId,
      token,
      expiresAt: exp ? new Date(exp * 1000).toISOString() : undefined,
      deadline: new Date(deadlineMs).toISOString(),
      pool: Object.values(sessionCache.pool),
    };
  } catch (error) {
    await releaseLock(lockKey);
    throw error;
  }
}

export async function submitVote(payload: RouletteVotePayload) {
  const data = rouletteVoteSchema.parse(payload);

  const sessionRows = await db
    .select()
    .from(schema.rouletteSessions)
    .where(eq(schema.rouletteSessions.id, data.sessionId))
    .limit(1);

  const session = sessionRows[0];

  if (!session || session.state !== 'collecting') {
    throw new Error('Roulette session is not accepting votes.');
  }

  const cache = await getSessionCache(data.sessionId);
  if (!cache) {
    throw new Error('Roulette session cache expired.');
  }

  const candidate = cache.pool[String(data.appId)];
  if (!candidate) {
    throw new Error('This game is not part of the current roulette pool.');
  }

  const participant = await db
    .select({ userId: schema.rouletteParticipants.userId })
    .from(schema.rouletteParticipants)
    .where(and(eq(schema.rouletteParticipants.sessionId, data.sessionId), eq(schema.rouletteParticipants.userId, data.userId)))
    .limit(1);

  if (!participant.length) {
    throw new Error('You are not part of this roulette session.');
  }

  const voteCount = await db
    .select({ value: sql<number>`count(*)` })
    .from(schema.rouletteVotes)
    .where(and(eq(schema.rouletteVotes.sessionId, data.sessionId), eq(schema.rouletteVotes.userId, data.userId)));

  if (voteCount[0]?.value && voteCount[0].value >= session.maxProposals) {
    throw new Error('You have reached the maximum number of proposals for this session.');
  }

  await db
    .insert(schema.rouletteVotes)
    .values({
      sessionId: data.sessionId,
      userId: data.userId,
      appId: data.appId,
    })
    .onConflictDoNothing();

  const totalVotes = await db
    .select({ value: sql<number>`count(*)` })
    .from(schema.rouletteVotes)
    .where(eq(schema.rouletteVotes.sessionId, data.sessionId));

  const remainingSeconds = Math.max(0, Math.ceil((cache.deadline - Date.now()) / 1000));

  sessionHub.emit(data.sessionId, 'session.updated', {
    sessionId: data.sessionId,
    remainingSeconds,
    votes: totalVotes[0]?.value ?? 0,
  });

  return { ok: true };
}

export async function closeRouletteSession(payload: RouletteClosePayload) {
  const data = rouletteCloseSchema.parse(payload);

  if (data.action === 'reroll') {
    return rerollResult(data.sessionId);
  }

  const sessionRows = await db
    .select()
    .from(schema.rouletteSessions)
    .where(eq(schema.rouletteSessions.id, data.sessionId))
    .limit(1);

  const session = sessionRows[0];

  if (!session) {
    throw new Error('Roulette session not found.');
  }

  if (session.state === 'closed') {
    const existing = await readStoredResult(data.sessionId);
    if (existing) {
      return existing;
    }
    throw new Error('Roulette session is already closed.');
  }

  const cache = await getSessionCache(data.sessionId);
  if (!cache) {
    throw new Error('Roulette session cache expired.');
  }

  const votes = await db
    .select({ appId: schema.rouletteVotes.appId, userId: schema.rouletteVotes.userId })
    .from(schema.rouletteVotes)
    .where(eq(schema.rouletteVotes.sessionId, data.sessionId));

  const voteGroups = new Map<number, Set<string>>();
  votes.forEach((vote) => {
    const group = voteGroups.get(vote.appId) ?? new Set<string>();
    group.add(vote.userId);
    voteGroups.set(vote.appId, group);
  });

  const weights: Record<string, number> = {};
  const entries = Object.values(cache.pool);

  entries.forEach((candidate) => {
    const voteSet = voteGroups.get(candidate.appId) ?? new Set<string>();
    const count = voteSet.size;
    const base = session.baseWeight;
    const increment = base * session.voteWeightPct;
    const weight = base + count * increment;
    weights[String(candidate.appId)] = weight;
    candidate.votes = Array.from(voteSet);
    candidate.weight = weight;
  });

  const aliasTable = buildAliasTable(
    Object.entries(weights).map(([appId, weight]) => ({ key: appId, weight })),
  );
  const sampled = Number(sampleAlias(aliasTable));

  await db.transaction(async (tx) => {
    await tx
      .update(schema.rouletteSessions)
      .set({ state: 'closed', closedAt: new Date() })
      .where(eq(schema.rouletteSessions.id, data.sessionId));

    await tx
      .insert(schema.rouletteResults)
      .values({ sessionId: data.sessionId, appId: sampled, weights })
      .onConflictDoUpdate({
        target: schema.rouletteResults.sessionId,
        set: { appId: sampled, weights, chosenAt: new Date() },
      });
  });

  clearSessionClock(session.id);
  await releaseLock(getGuildLockKey(session.guildId));
  await deleteSessionCache(data.sessionId);

  const result: RouletteResult = {
    sessionId: data.sessionId,
    appId: sampled,
    weights,
    chosenAt: new Date().toISOString(),
  };

  sessionHub.emit(data.sessionId, 'session.closed', result);

  return result;
}

async function rerollResult(sessionId: string) {
  const existingResult = await readStoredResult(sessionId);

  if (!existingResult) {
    throw new Error('No previous roulette result to reroll.');
  }

  const weightsRecord = existingResult.weights;
  const aliasTable = buildAliasTable(
    Object.entries(weightsRecord).map(([key, weight]) => ({ key, weight })),
  );
  const sampled = Number(sampleAlias(aliasTable));

  await db
    .update(schema.rouletteResults)
    .set({ appId: sampled, chosenAt: new Date() })
    .where(eq(schema.rouletteResults.sessionId, sessionId));

  const result: RouletteResult = {
    sessionId,
    appId: sampled,
    weights: weightsRecord,
    chosenAt: new Date().toISOString(),
  };
  sessionHub.emit(sessionId, 'session.closed', result);
  return result;
}

async function readStoredResult(sessionId: string): Promise<RouletteResult | null> {
  const rows = await db
    .select({
      sessionId: schema.rouletteResults.sessionId,
      appId: schema.rouletteResults.appId,
      weights: schema.rouletteResults.weights,
      chosenAt: schema.rouletteResults.chosenAt,
    })
    .from(schema.rouletteResults)
    .where(eq(schema.rouletteResults.sessionId, sessionId))
    .limit(1);

  const entry = rows[0];
  if (!entry) {
    return null;
  }

  return {
    sessionId: entry.sessionId,
    appId: entry.appId,
    weights: entry.weights as Record<string, number>,
    chosenAt: entry.chosenAt?.toISOString() ?? new Date().toISOString(),
  };
}

function getGuildLockKey(guildId: string) {
  return `lock:guild:${guildId}:roulette`;
}

async function upsertUsers(userIds: string[]) {
  if (!userIds.length) {
    return;
  }
  await db
    .insert(schema.users)
    .values(userIds.map((userId) => ({ idDiscord: userId })))
    .onConflictDoNothing();
}

type SteamLinkRecord = {
  userId: string;
  steamId64: string;
  visibilityOk: boolean;
};

async function loadSteamLinks(userIds: string[]) {
  if (!userIds.length) {
    return new Map<string, SteamLinkRecord>();
  }

  const rows = await db
    .select({
      userId: schema.steamLinks.userId,
      steamId64: schema.steamLinks.steamId64,
      visibilityOk: schema.steamLinks.visibilityOk,
    })
    .from(schema.steamLinks)
    .where(inArray(schema.steamLinks.userId, userIds));

  return new Map(rows.map((row) => [row.userId, row]));
}

type OwnershipCandidate = {
  appId: number;
  name: string;
  owners: Set<string>;
};

async function buildOwnershipMap(links: SteamLinkRecord[]) {
  const map = new Map<number, OwnershipCandidate>();

  for (const link of links) {
    const ownedGames = await getOwnedGames(link.steamId64);
    if (!ownedGames.visibilityOk) {
      await db
        .update(schema.steamLinks)
        .set({ visibilityOk: false })
        .where(eq(schema.steamLinks.userId, link.userId));
      throw new Error(`Steam privacy settings must allow game visibility for ${link.userId}`);
    }

    await db
      .update(schema.steamLinks)
      .set({ visibilityOk: true })
      .where(eq(schema.steamLinks.userId, link.userId));

    for (const game of ownedGames.games) {
      const entry = map.get(game.appid) ?? {
        appId: game.appid,
        name: game.name,
        owners: new Set<string>(),
      };
      entry.owners.add(link.userId);
      map.set(game.appid, entry);
    }
  }

  return map;
}

function filterByPool(candidate: OwnershipCandidate, mode: string, participantCount: number) {
  if (mode === 'intersection') {
    return candidate.owners.size === participantCount;
  }
  return true;
}

function filterByOwnership(
  candidate: OwnershipCandidate,
  mode: string,
  threshold: number,
  participantCount: number,
) {
  if (mode === 'all') {
    return candidate.owners.size === participantCount;
  }
  if (mode === 'threshold') {
    return candidate.owners.size / participantCount >= threshold;
  }
  return true;
}

async function saveSessionCache(cache: SessionCache) {
  await redis.set(sessionCacheKey(cache.sessionId), JSON.stringify(cache), 'EX', SESSION_CACHE_TTL_SECONDS);
}

export async function getSessionCache(sessionId: string): Promise<SessionCache | null> {
  const payload = await redis.get(sessionCacheKey(sessionId));
  if (!payload) {
    return null;
  }
  try {
    return JSON.parse(payload) as SessionCache;
  } catch (error) {
    console.error('Failed to parse session cache', error);
    return null;
  }
}

export async function deleteSessionCache(sessionId: string) {
  await redis.del(sessionCacheKey(sessionId));
}

function sessionCacheKey(sessionId: string) {
  return `${SESSION_CACHE_PREFIX}${sessionId}`;
}
