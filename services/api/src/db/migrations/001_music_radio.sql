-- Migration: Music Radio & Playback History System
-- Created: 2025-11-25

-- Playback history table
CREATE TABLE IF NOT EXISTS playback_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id VARCHAR(32) NOT NULL,
  track_id TEXT NOT NULL,
  track_title TEXT NOT NULL,
  track_author TEXT,
  track_duration INTEGER, -- milliseconds
  track_uri TEXT,
  track_source TEXT, -- 'youtube', 'soundcloud', 'bandcamp', 'http'
  requested_by TEXT, -- user_id or 'radio'
  played_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  completion_rate NUMERIC(3,2), -- 0.0 to 1.0
  skipped BOOLEAN DEFAULT false,
  skip_reason TEXT, -- 'user', 'error', 'stuck', null
  audio_features JSONB -- for future: tempo, energy, etc
);

CREATE INDEX IF NOT EXISTS idx_playback_history_guild ON playback_history(guild_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_playback_history_track ON playback_history(track_id);
CREATE INDEX IF NOT EXISTS idx_playback_history_requested ON playback_history(requested_by);

-- Guild playlists
CREATE TABLE IF NOT EXISTS guild_playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id VARCHAR(32) NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'user', 'radio', 'scheduled'
  created_by VARCHAR(32),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  is_active BOOLEAN DEFAULT true,
  metadata JSONB -- radio settings, filters, etc
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_guild_playlists_guild_name ON guild_playlists(guild_id, name);
CREATE INDEX IF NOT EXISTS idx_guild_playlists_active ON guild_playlists(guild_id, is_active);

-- Tracks in playlists
CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id UUID REFERENCES guild_playlists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  track_id TEXT NOT NULL,
  track_data JSONB NOT NULL, -- full track info cached
  added_by VARCHAR(32),
  added_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  play_count INTEGER DEFAULT 0,
  last_played_at TIMESTAMPTZ,
  PRIMARY KEY (playlist_id, position)
);

CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track_id ON playlist_tracks(track_id);

-- Radio configuration per guild
CREATE TABLE IF NOT EXISTS guild_radio_settings (
  guild_id VARCHAR(32) PRIMARY KEY,
  enabled BOOLEAN DEFAULT false,
  algorithm TEXT DEFAULT 'similarity', -- 'similarity', 'genre', 'mixed'
  similarity_threshold NUMERIC(3,2) DEFAULT 0.7,
  genre_diversity NUMERIC(3,2) DEFAULT 0.3, -- 0=same genre, 1=any genre
  tempo_variance INTEGER DEFAULT 20, -- BPM variance allowed
  energy_variance NUMERIC(3,2) DEFAULT 0.2,
  history_lookback_hours INTEGER DEFAULT 24,
  min_queue_size INTEGER DEFAULT 3, -- min tracks to maintain
  max_queue_size INTEGER DEFAULT 10,
  avoid_repeat_hours INTEGER DEFAULT 2, -- don't repeat song within N hours
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Track similarity cache
CREATE TABLE IF NOT EXISTS track_similarity (
  track_a_id TEXT NOT NULL,
  track_b_id TEXT NOT NULL,
  similarity_score NUMERIC(3,2) NOT NULL, -- 0.0 to 1.0
  algorithm_version TEXT NOT NULL,
  calculated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  features_matched JSONB,
  PRIMARY KEY (track_a_id, track_b_id)
);

CREATE INDEX IF NOT EXISTS idx_track_similarity_score ON track_similarity(similarity_score DESC);
CREATE INDEX IF NOT EXISTS idx_track_similarity_track_a ON track_similarity(track_a_id);

-- Audio features cache
CREATE TABLE IF NOT EXISTS audio_features (
  track_id TEXT PRIMARY KEY,
  tempo NUMERIC(6,2), -- BPM
  energy NUMERIC(3,2), -- 0.0 to 1.0
  danceability NUMERIC(3,2), -- 0.0 to 1.0
  valence NUMERIC(3,2), -- 0.0 to 1.0 (mood: sad to happy)
  loudness NUMERIC(6,2), -- dB
  speechiness NUMERIC(3,2), -- 0.0 to 1.0
  acousticness NUMERIC(3,2), -- 0.0 to 1.0
  instrumentalness NUMERIC(3,2), -- 0.0 to 1.0
  liveness NUMERIC(3,2), -- 0.0 to 1.0
  genres TEXT[], -- genre tags
  tags TEXT[], -- custom tags
  provider TEXT, -- 'spotify', 'lastfm', 'acoustid', 'essentia', 'estimated'
  provider_id TEXT, -- external ID from provider
  analyzed_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  metadata JSONB -- additional provider-specific data
);

CREATE INDEX IF NOT EXISTS idx_audio_features_genres ON audio_features USING GIN(genres);
CREATE INDEX IF NOT EXISTS idx_audio_features_tags ON audio_features USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_audio_features_provider ON audio_features(provider, provider_id);
