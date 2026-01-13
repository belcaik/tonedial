import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const rouletteStateEnum = pgEnum('roulette_state', ['pending', 'collecting', 'closed', 'cancelled']);

export const users = pgTable('users', {
  idDiscord: varchar('id_discord', { length: 32 }).primaryKey(),
  tz: varchar('tz', { length: 64 }).default('UTC'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const steamLinks = pgTable(
  'steam_links',
  {
    userId: varchar('user_id', { length: 32 })
      .references(() => users.idDiscord, { onDelete: 'cascade' })
      .notNull(),
    steamId64: varchar('steamid64', { length: 32 }).notNull(),
    visibilityOk: boolean('visibility_ok').default(false).notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: { columns: [table.userId], name: 'steam_links_pk' },
    steamIdIdx: index('steam_links_steamid_idx').on(table.steamId64),
  }),
);

export const games = pgTable(
  'games',
  {
    appId: integer('appid').primaryKey(),
    name: text('name').notNull(),
    categories: text('categories').array().notNull(),
    isMultiplayer: boolean('is_multiplayer').default(false).notNull(),
    maxPlayers: integer('max_players'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    categoriesIdx: index('games_categories_idx').on(table.categories),
  }),
);

export const guildSettings = pgTable('guild_settings', {
  guildId: varchar('guild_id', { length: 32 }).primaryKey(),
  voteWindowSec: integer('vote_window_sec').default(60).notNull(),
  baseWeight: doublePrecision('base_weight').default(1).notNull(),
  voteWeightPct: doublePrecision('vote_weight_pct').default(0.25).notNull(),
  poolMode: varchar('pool_mode', { length: 16 }).default('intersection').notNull(),
  ownershipMode: varchar('ownership_mode', { length: 16 }).default('all').notNull(),
});

export const rouletteSessions = pgTable(
  'roulette_sessions',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    textChannelId: varchar('text_channel_id', { length: 32 }).notNull(),
    voiceChannelId: varchar('voice_channel_id', { length: 32 }).notNull(),
    createdBy: varchar('created_by', { length: 32 }).notNull(),
    state: rouletteStateEnum('state').default('pending').notNull(),
    maxProposals: integer('max_proposals').notNull(),
    timeSeconds: integer('time_sec').notNull(),
    ownershipMode: varchar('ownership_mode', { length: 16 }).notNull(),
    poolMode: varchar('pool_mode', { length: 16 }).notNull(),
    minPlayers: integer('min_players'),
    ownershipThresholdPct: doublePrecision('ownership_threshold_pct'),
    baseWeight: doublePrecision('base_weight').default(1).notNull(),
    voteWeightPct: doublePrecision('vote_weight_pct').default(0.25).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => ({
    guildIdx: index('roulette_sessions_guild_idx').on(table.guildId),
  }),
);

export const rouletteParticipants = pgTable(
  'roulette_participants',
  {
    sessionId: varchar('session_id', { length: 36 })
      .references(() => rouletteSessions.id, { onDelete: 'cascade' })
      .notNull(),
    userId: varchar('user_id', { length: 32 })
      .references(() => users.idDiscord, { onDelete: 'cascade' })
      .notNull(),
  },
  (table) => ({
    pk: { columns: [table.sessionId, table.userId], name: 'roulette_participants_pk' },
    sessionIdx: index('roulette_participants_session_idx').on(table.sessionId),
  }),
);

export const rouletteVotes = pgTable(
  'roulette_votes',
  {
    sessionId: varchar('session_id', { length: 36 })
      .references(() => rouletteSessions.id, { onDelete: 'cascade' })
      .notNull(),
    userId: varchar('user_id', { length: 32 })
      .references(() => users.idDiscord, { onDelete: 'cascade' })
      .notNull(),
    appId: integer('appid').references(() => games.appId, { onDelete: 'cascade' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: { columns: [table.sessionId, table.userId, table.appId], name: 'roulette_votes_pk' },
    sessionIdx: index('roulette_votes_session_idx').on(table.sessionId),
    appIdx: index('roulette_votes_app_idx').on(table.appId),
  }),
);

export const rouletteResults = pgTable(
  'roulette_results',
  {
    sessionId: varchar('session_id', { length: 36 })
      .references(() => rouletteSessions.id, { onDelete: 'cascade' })
      .notNull(),
    appId: integer('appid').references(() => games.appId).notNull(),
    weights: jsonb('weights').$type<Record<string, number>>().notNull(),
    chosenAt: timestamp('chosen_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: { columns: [table.sessionId], name: 'roulette_results_pk' },
    appIdx: index('roulette_results_app_idx').on(table.appId),
  }),
);

// ============================================================
// Music Radio & Playback History Tables
// ============================================================

export const playbackHistory = pgTable(
  'playback_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    trackId: text('track_id').notNull(),
    trackTitle: text('track_title').notNull(),
    trackAuthor: text('track_author'),
    trackDuration: integer('track_duration'), // milliseconds
    trackUri: text('track_uri'),
    trackSource: text('track_source'), // 'youtube', 'soundcloud', etc
    requestedBy: text('requested_by'), // user_id or 'radio'
    playedAt: timestamp('played_at', { withTimezone: true }).defaultNow().notNull(),
    completionRate: numeric('completion_rate', { precision: 3, scale: 2 }), // 0.0 to 1.0
    skipped: boolean('skipped').default(false),
    skipReason: text('skip_reason'), // 'user', 'error', 'stuck'
    audioFeatures: jsonb('audio_features'),
  },
  (table) => ({
    guildIdx: index('playback_history_guild_idx').on(table.guildId, table.playedAt),
    trackIdx: index('playback_history_track_idx').on(table.trackId),
    requestedIdx: index('playback_history_requested_idx').on(table.requestedBy),
  }),
);

export const guildPlaylists = pgTable(
  'guild_playlists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    name: text('name').notNull(),
    type: text('type').notNull(), // 'user', 'radio', 'scheduled'
    createdBy: varchar('created_by', { length: 32 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    isActive: boolean('is_active').default(true),
    metadata: jsonb('metadata'),
  },
  (table) => ({
    guildNameIdx: index('guild_playlists_guild_name_idx').on(table.guildId, table.name),
    activeIdx: index('guild_playlists_active_idx').on(table.guildId, table.isActive),
  }),
);

export const playlistTracks = pgTable(
  'playlist_tracks',
  {
    playlistId: uuid('playlist_id')
      .references(() => guildPlaylists.id, { onDelete: 'cascade' })
      .notNull(),
    position: integer('position').notNull(),
    trackId: text('track_id').notNull(),
    trackData: jsonb('track_data').notNull(),
    addedBy: varchar('added_by', { length: 32 }),
    addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
    playCount: integer('play_count').default(0),
    lastPlayedAt: timestamp('last_played_at', { withTimezone: true }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.playlistId, table.position] }),
    trackIdx: index('playlist_tracks_track_id_idx').on(table.trackId),
  }),
);

export const guildRadioSettings = pgTable('guild_radio_settings', {
  guildId: varchar('guild_id', { length: 32 }).primaryKey(),
  enabled: boolean('enabled').default(false),
  algorithm: text('algorithm').default('similarity'), // 'similarity', 'genre', 'mixed'
  similarityThreshold: numeric('similarity_threshold', { precision: 3, scale: 2 }).default('0.7'),
  genreDiversity: numeric('genre_diversity', { precision: 3, scale: 2 }).default('0.3'),
  tempoVariance: integer('tempo_variance').default(20), // BPM
  energyVariance: numeric('energy_variance', { precision: 3, scale: 2 }).default('0.2'),
  historyLookbackHours: integer('history_lookback_hours').default(24),
  minQueueSize: integer('min_queue_size').default(3),
  maxQueueSize: integer('max_queue_size').default(10),
  avoidRepeatHours: integer('avoid_repeat_hours').default(2),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const trackSimilarity = pgTable(
  'track_similarity',
  {
    trackAId: text('track_a_id').notNull(),
    trackBId: text('track_b_id').notNull(),
    similarityScore: numeric('similarity_score', { precision: 3, scale: 2 }).notNull(),
    algorithmVersion: text('algorithm_version').notNull(),
    calculatedAt: timestamp('calculated_at', { withTimezone: true }).defaultNow().notNull(),
    featuresMatched: jsonb('features_matched'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.trackAId, table.trackBId] }),
    scoreIdx: index('track_similarity_score_idx').on(table.similarityScore),
    trackAIdx: index('track_similarity_track_a_idx').on(table.trackAId),
  }),
);

export const audioFeatures = pgTable(
  'audio_features',
  {
    trackId: text('track_id').primaryKey(),
    tempo: numeric('tempo', { precision: 6, scale: 2 }), // BPM
    energy: numeric('energy', { precision: 3, scale: 2 }),
    danceability: numeric('danceability', { precision: 3, scale: 2 }),
    valence: numeric('valence', { precision: 3, scale: 2 }), // mood
    loudness: numeric('loudness', { precision: 6, scale: 2 }), // dB
    speechiness: numeric('speechiness', { precision: 3, scale: 2 }),
    acousticness: numeric('acousticness', { precision: 3, scale: 2 }),
    instrumentalness: numeric('instrumentalness', { precision: 3, scale: 2 }),
    liveness: numeric('liveness', { precision: 3, scale: 2 }),
    genres: text('genres').array(),
    tags: text('tags').array(),
    provider: text('provider'), // 'spotify', 'lastfm', etc
    providerId: text('provider_id'),
    analyzedAt: timestamp('analyzed_at', { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb('metadata'),
  },
  (table) => ({
    genresIdx: index('audio_features_genres_idx').on(table.genres),
    tagsIdx: index('audio_features_tags_idx').on(table.tags),
    providerIdx: index('audio_features_provider_idx').on(table.provider, table.providerId),
  }),
);
