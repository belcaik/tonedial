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
  `CREATE TABLE IF NOT EXISTS playback_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      guild_id VARCHAR(32) NOT NULL,
      track_id TEXT NOT NULL,
      track_title TEXT NOT NULL,
      track_author TEXT,
      track_duration INTEGER,
      track_uri TEXT,
      track_source TEXT,
      requested_by TEXT,
      played_at TIMESTAMPTZ DEFAULT now() NOT NULL,
      completion_rate NUMERIC(3,2),
      skipped BOOLEAN DEFAULT false,
      skip_reason TEXT,
      audio_features JSONB
    );`,
  `CREATE INDEX IF NOT EXISTS playback_history_guild_idx ON playback_history (guild_id, played_at);`,
  `CREATE INDEX IF NOT EXISTS playback_history_track_idx ON playback_history (track_id);`,
  `CREATE INDEX IF NOT EXISTS playback_history_requested_idx ON playback_history (requested_by);`,
  `CREATE TABLE IF NOT EXISTS guild_playlists (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      guild_id VARCHAR(32) NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      created_by VARCHAR(32),
      created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
      is_active BOOLEAN DEFAULT true,
      metadata JSONB
    );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS guild_playlists_guild_name_idx ON guild_playlists (guild_id, name);`,
  `CREATE INDEX IF NOT EXISTS guild_playlists_active_idx ON guild_playlists (guild_id, is_active);`,
  `CREATE TABLE IF NOT EXISTS playlist_tracks (
      playlist_id UUID REFERENCES guild_playlists(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      track_id TEXT NOT NULL,
      track_data JSONB NOT NULL,
      added_by VARCHAR(32),
      added_at TIMESTAMPTZ DEFAULT now() NOT NULL,
      play_count INTEGER DEFAULT 0,
      last_played_at TIMESTAMPTZ,
      PRIMARY KEY (playlist_id, position)
    );`,
  `CREATE INDEX IF NOT EXISTS playlist_tracks_track_id_idx ON playlist_tracks (track_id);`,
  `CREATE TABLE IF NOT EXISTS guild_radio_settings (
      guild_id VARCHAR(32) PRIMARY KEY,
      enabled BOOLEAN DEFAULT false,
      algorithm TEXT DEFAULT 'similarity',
      similarity_threshold NUMERIC(3,2) DEFAULT 0.7,
      genre_diversity NUMERIC(3,2) DEFAULT 0.3,
      tempo_variance INTEGER DEFAULT 20,
      energy_variance NUMERIC(3,2) DEFAULT 0.2,
      history_lookback_hours INTEGER DEFAULT 24,
      min_queue_size INTEGER DEFAULT 3,
      max_queue_size INTEGER DEFAULT 10,
      avoid_repeat_hours INTEGER DEFAULT 2,
      updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
    );`,
  `CREATE TABLE IF NOT EXISTS track_similarity (
      track_a_id TEXT NOT NULL,
      track_b_id TEXT NOT NULL,
      similarity_score NUMERIC(3,2) NOT NULL,
      algorithm_version TEXT NOT NULL,
      calculated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
      features_matched JSONB,
      PRIMARY KEY (track_a_id, track_b_id)
    );`,
  `CREATE INDEX IF NOT EXISTS track_similarity_score_idx ON track_similarity (similarity_score);`,
  `CREATE INDEX IF NOT EXISTS track_similarity_track_a_idx ON track_similarity (track_a_id);`,
  `CREATE TABLE IF NOT EXISTS audio_features (
      track_id TEXT PRIMARY KEY,
      tempo NUMERIC(6,2),
      energy NUMERIC(3,2),
      danceability NUMERIC(3,2),
      valence NUMERIC(3,2),
      loudness NUMERIC(6,2),
      speechiness NUMERIC(3,2),
      acousticness NUMERIC(3,2),
      instrumentalness NUMERIC(3,2),
      liveness NUMERIC(3,2),
      genres TEXT[],
      tags TEXT[],
      provider TEXT,
      provider_id TEXT,
      analyzed_at TIMESTAMPTZ DEFAULT now() NOT NULL,
      metadata JSONB
    );`,
  `CREATE INDEX IF NOT EXISTS audio_features_genres_idx ON audio_features USING GIN (genres);`,
  `CREATE INDEX IF NOT EXISTS audio_features_tags_idx ON audio_features USING GIN (tags);`,
  `CREATE INDEX IF NOT EXISTS audio_features_provider_idx ON audio_features (provider, provider_id);`,
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
