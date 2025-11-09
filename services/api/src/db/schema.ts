import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
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
