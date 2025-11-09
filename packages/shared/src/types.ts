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
  pool: z.array(rouletteGameCandidateSchema),
  rules: rouletteRulesSchema.omit({ createdBy: true }),
});
export type RouletteSessionSnapshot = z.infer<typeof rouletteSessionSnapshotSchema>;

export const sessionEventTypes = ['session.created', 'session.updated', 'session.closed'] as const satisfies Readonly<
  [string, ...string[]]
>;
export type SessionEventType = (typeof sessionEventTypes)[number];

export type RouletteSessionEvent =
  | { type: 'session.created'; payload: RouletteSessionSnapshot }
  | { type: 'session.updated'; payload: { sessionId: string; remainingSeconds: number; votes: number } }
  | { type: 'session.closed'; payload: RouletteResult };

export const activityAuthSchema = z.object({
  sessionId: z.string(),
  guildId: z.string(),
  exp: z.number(),
});
export type ActivityAuthClaims = z.infer<typeof activityAuthSchema>;
