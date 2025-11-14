import { sql } from 'drizzle-orm';
import { db } from './client.js';

const BOOTSTRAP_STATEMENTS = [
  `DO $$
   BEGIN
     CREATE TYPE roulette_state AS ENUM ('pending', 'collecting', 'closed', 'cancelled');
   EXCEPTION
     WHEN duplicate_object THEN NULL;
   END
  $$;`,
  `CREATE TABLE IF NOT EXISTS users (
      id_discord VARCHAR(32) PRIMARY KEY,
      tz VARCHAR(64) DEFAULT 'UTC',
      created_at TIMESTAMPTZ DEFAULT now() NOT NULL
    );`,
  `CREATE TABLE IF NOT EXISTS steam_links (
      user_id VARCHAR(32) REFERENCES users(id_discord) ON DELETE CASCADE,
      steamid64 VARCHAR(32) NOT NULL,
      visibility_ok BOOLEAN DEFAULT false NOT NULL,
      linked_at TIMESTAMPTZ DEFAULT now() NOT NULL,
      PRIMARY KEY (user_id)
    );`,
  `CREATE INDEX IF NOT EXISTS steam_links_steamid_idx ON steam_links (steamid64);`,
  `CREATE TABLE IF NOT EXISTS games (
      appid INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      categories TEXT[] NOT NULL,
      is_multiplayer BOOLEAN DEFAULT false NOT NULL,
      max_players INTEGER,
      updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
    );`,
  `CREATE INDEX IF NOT EXISTS games_categories_idx ON games USING GIN (categories);`,
  `CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id VARCHAR(32) PRIMARY KEY,
      vote_window_sec INTEGER DEFAULT 60 NOT NULL,
      base_weight DOUBLE PRECISION DEFAULT 1 NOT NULL,
      vote_weight_pct DOUBLE PRECISION DEFAULT 0.25 NOT NULL,
      pool_mode VARCHAR(16) DEFAULT 'intersection' NOT NULL,
      ownership_mode VARCHAR(16) DEFAULT 'all' NOT NULL
    );`,
  `CREATE TABLE IF NOT EXISTS roulette_sessions (
      id VARCHAR(36) PRIMARY KEY,
      guild_id VARCHAR(32) NOT NULL,
      text_channel_id VARCHAR(32) NOT NULL,
      voice_channel_id VARCHAR(32) NOT NULL,
      created_by VARCHAR(32) NOT NULL,
      state roulette_state DEFAULT 'pending' NOT NULL,
      max_proposals INTEGER NOT NULL,
      time_sec INTEGER NOT NULL,
      ownership_mode VARCHAR(16) NOT NULL,
      pool_mode VARCHAR(16) NOT NULL,
      min_players INTEGER,
      ownership_threshold_pct DOUBLE PRECISION,
      base_weight DOUBLE PRECISION DEFAULT 1 NOT NULL,
      vote_weight_pct DOUBLE PRECISION DEFAULT 0.25 NOT NULL,
      started_at TIMESTAMPTZ DEFAULT now() NOT NULL,
      closed_at TIMESTAMPTZ
    );`,
  `CREATE INDEX IF NOT EXISTS roulette_sessions_guild_idx ON roulette_sessions (guild_id);`,
  `CREATE TABLE IF NOT EXISTS roulette_participants (
      session_id VARCHAR(36) REFERENCES roulette_sessions(id) ON DELETE CASCADE,
      user_id VARCHAR(32) REFERENCES users(id_discord) ON DELETE CASCADE,
      PRIMARY KEY (session_id, user_id)
    );`,
  `CREATE INDEX IF NOT EXISTS roulette_participants_session_idx ON roulette_participants (session_id);`,
  `CREATE TABLE IF NOT EXISTS roulette_votes (
      session_id VARCHAR(36) REFERENCES roulette_sessions(id) ON DELETE CASCADE,
      user_id VARCHAR(32) REFERENCES users(id_discord) ON DELETE CASCADE,
      appid INTEGER REFERENCES games(appid) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
      PRIMARY KEY (session_id, user_id, appid)
    );`,
  `CREATE INDEX IF NOT EXISTS roulette_votes_session_idx ON roulette_votes (session_id);`,
  `CREATE INDEX IF NOT EXISTS roulette_votes_app_idx ON roulette_votes (appid);`,
  `CREATE TABLE IF NOT EXISTS roulette_results (
      session_id VARCHAR(36) REFERENCES roulette_sessions(id) ON DELETE CASCADE,
      appid INTEGER REFERENCES games(appid),
      weights JSONB NOT NULL,
      chosen_at TIMESTAMPTZ DEFAULT now() NOT NULL,
      PRIMARY KEY (session_id)
    );`,
  `CREATE INDEX IF NOT EXISTS roulette_results_app_idx ON roulette_results (appid);`,
];

let bootstrapping: Promise<void> | null = null;

export function ensureBaseSchema() {
  if (!bootstrapping) {
    bootstrapping = (async () => {
      for (const statement of BOOTSTRAP_STATEMENTS) {
        await db.execute(sql.raw(statement));
      }
    })();
  }
  return bootstrapping;
}
