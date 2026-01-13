import { z } from 'zod';

export const ownershipModes = ['all', 'threshold'] as const satisfies Readonly<[string, ...string[]]>;
export type OwnershipMode = (typeof ownershipModes)[number];

export const poolModes = ['intersection', 'union'] as const satisfies Readonly<[string, ...string[]]>;
export type PoolMode = (typeof poolModes)[number];

export const rouletteStates = ['pending', 'collecting', 'closed', 'cancelled'] as const satisfies Readonly<
  [string, ...string[]]
>;
export type RouletteState = (typeof rouletteStates)[number];

export const rouletteRulesSchema = z.object({
  guildId: z.string(),
  textChannelId: z.string(),
  voiceChannelId: z.string(),
  createdBy: z.string(),
  maxProposals: z.number().int().min(1).max(10),
  timeSeconds: z.number().int().min(10).max(600),
  ownershipMode: z.enum(ownershipModes),
  poolMode: z.enum(poolModes),
  minPlayers: z.number().int().min(1).max(16).optional(),
  ownershipThresholdPct: z.number().min(0).max(1).optional(),
  baseWeight: z.number().positive().default(1),
  voteWeightPct: z.number().min(0).max(10).default(0.25),
});
export type RouletteRules = z.infer<typeof rouletteRulesSchema>;

export const rouletteParticipantSchema = z.object({
  userId: z.string(),
  steamId64: z.string().optional(),
  displayName: z.string().optional(),
});
export type RouletteParticipant = z.infer<typeof rouletteParticipantSchema>;

export const createSessionSchema = z.object({
  rules: rouletteRulesSchema,
  participants: z.array(rouletteParticipantSchema).min(1),
});
export type CreateSessionPayload = z.infer<typeof createSessionSchema>;

export const rouletteVoteSchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  appId: z.number().int().positive(),
});
export type RouletteVotePayload = z.infer<typeof rouletteVoteSchema>;

export const rouletteCloseSchema = z.object({
  sessionId: z.string(),
  requestedBy: z.string(),
  action: z.enum(['close', 'reroll']).default('close').optional(),
});
export type RouletteClosePayload = z.infer<typeof rouletteCloseSchema>;

export const steamOwnedGameSchema = z.object({
  appid: z.number().int().positive(),
  name: z.string(),
  playtime_forever: z.number().int().nonnegative().default(0),
});
export type SteamOwnedGame = z.infer<typeof steamOwnedGameSchema>;

export const steamOwnedResponseSchema = z.object({
  steamId64: z.string(),
  visibilityOk: z.boolean(),
  games: z.array(steamOwnedGameSchema),
  fetchedAt: z.string(),
});
export type SteamOwnedResponse = z.infer<typeof steamOwnedResponseSchema>;

export const steamLinkStatusSchema = z.discriminatedUnion('linked', [
  z.object({
    linked: z.literal(false),
    userId: z.string(),
  }),
  z.object({
    linked: z.literal(true),
    userId: z.string(),
    steamId64: z.string(),
    visibilityOk: z.boolean(),
    linkedAt: z.string().optional(),
    totalGames: z.number().int().nonnegative().optional(),
    cacheRefreshedAt: z.string().optional(),
  }),
]);
export type SteamLinkStatus = z.infer<typeof steamLinkStatusSchema>;

export const gameMetadataSchema = z.object({
  appId: z.number().int().positive(),
  name: z.string(),
  categories: z.array(z.string()),
  isMultiplayer: z.boolean(),
  maxPlayers: z.number().int().positive().optional(),
  updatedAt: z.string(),
});
export type GameMetadata = z.infer<typeof gameMetadataSchema>;

export const rouletteGameCandidateSchema = z.object({
  appId: z.number().int().positive(),
  name: z.string(),
  owners: z.array(z.string()),
  isMultiplayer: z.boolean(),
  maxPlayers: z.number().int().positive().optional(),
  weight: z.number().positive(),
  votes: z.array(z.string()),
});
export type RouletteGameCandidate = z.infer<typeof rouletteGameCandidateSchema>;

export const rouletteResultSchema = z.object({
  sessionId: z.string(),
  appId: z.number().int().positive(),
  weights: z.record(z.string(), z.number().positive()),
  chosenAt: z.string(),
});
export type RouletteResult = z.infer<typeof rouletteResultSchema>;

export const rouletteSessionSnapshotSchema = z.object({
  sessionId: z.string(),
  deadline: z.string(),
  serverTime: z.string(),
  ownerId: z.string().optional(),
  pool: z.array(rouletteGameCandidateSchema),
  rules: rouletteRulesSchema.omit({ createdBy: true }),
});
export type RouletteSessionSnapshot = z.infer<typeof rouletteSessionSnapshotSchema>;

export const sessionEventTypes = [
  'session.created',
  'session.updated',
  'session.closed',
  'session.tick',
] as const satisfies Readonly<[string, ...string[]]>;
export type SessionEventType = (typeof sessionEventTypes)[number];

export type RouletteSessionEvent =
  | { type: 'session.created'; payload: RouletteSessionSnapshot }
  | { type: 'session.updated'; payload: { sessionId: string; remainingSeconds: number; votes: number } }
  | { type: 'session.closed'; payload: RouletteResult }
  | { type: 'session.tick'; payload: { sessionId: string; remainingSeconds: number; serverTime: string } };

export const activityAuthSchema = z.object({
  sid: z.string(),
  gid: z.string(),
  cid: z.string(),
  vcid: z.string(),
  sub: z.string().optional(),
  aud: z.string().optional(),
  iss: z.string().optional(),
  exp: z.number(),
});
export type ActivityAuthClaims = z.infer<typeof activityAuthSchema>;

// ============================================================
// Music Radio Types
// ============================================================

export const audioFeaturesSchema = z.object({
  tempo: z.number().optional(), // BPM
  energy: z.number().min(0).max(1).optional(),
  danceability: z.number().min(0).max(1).optional(),
  valence: z.number().min(0).max(1).optional(), // mood: sad to happy
  loudness: z.number().optional(), // dB
  speechiness: z.number().min(0).max(1).optional(),
  acousticness: z.number().min(0).max(1).optional(),
  instrumentalness: z.number().min(0).max(1).optional(),
  liveness: z.number().min(0).max(1).optional(),
  genres: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  provider: z.enum(['spotify', 'lastfm', 'acoustid', 'essentia', 'estimated']).optional(),
  providerId: z.string().optional(),
});
export type AudioFeatures = z.infer<typeof audioFeaturesSchema>;

export const trackInfoSchema = z.object({
  id: z.string(), // unique track identifier (hash of uri + source)
  title: z.string(),
  author: z.string().optional(),
  duration: z.number().int().positive().optional(), // milliseconds
  uri: z.string().optional(),
  source: z.enum(['youtube', 'soundcloud', 'bandcamp', 'http', 'spotify']),
  audioFeatures: audioFeaturesSchema.optional(),
});
export type TrackInfo = z.infer<typeof trackInfoSchema>;

export const radioAlgorithms = ['similarity', 'genre', 'mixed'] as const;
export type RadioAlgorithm = (typeof radioAlgorithms)[number];

export const radioSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  algorithm: z.enum(radioAlgorithms).default('similarity'),
  similarityThreshold: z.number().min(0).max(1).default(0.7),
  genreDiversity: z.number().min(0).max(1).default(0.3),
  tempoVariance: z.number().int().positive().default(20), // BPM
  energyVariance: z.number().min(0).max(1).default(0.2),
  historyLookbackHours: z.number().int().positive().default(24),
  minQueueSize: z.number().int().positive().default(3),
  maxQueueSize: z.number().int().positive().default(10),
  avoidRepeatHours: z.number().int().positive().default(2),
});
export type RadioSettings = z.infer<typeof radioSettingsSchema>;

export const trackSimilaritySchema = z.object({
  trackAId: z.string(),
  trackBId: z.string(),
  score: z.number().min(0).max(1),
  featuresMatched: z.record(z.string(), z.number()).optional(),
});
export type TrackSimilarity = z.infer<typeof trackSimilaritySchema>;

export const playbackHistoryEntrySchema = z.object({
  id: z.string().uuid(),
  guildId: z.string(),
  trackId: z.string(),
  trackTitle: z.string(),
  trackAuthor: z.string().optional(),
  trackDuration: z.number().int().optional(),
  trackUri: z.string().optional(),
  trackSource: z.string().optional(),
  requestedBy: z.string(), // user_id or 'radio'
  playedAt: z.string(), // ISO timestamp
  completionRate: z.number().min(0).max(1).optional(),
  skipped: z.boolean().default(false),
  skipReason: z.enum(['user', 'error', 'stuck']).optional(),
});
export type PlaybackHistoryEntry = z.infer<typeof playbackHistoryEntrySchema>;
