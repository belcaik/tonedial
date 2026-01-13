import type { AudioFeatures, TrackInfo } from '@tonedial/shared';
import crypto from 'node:crypto';
import type { Redis } from 'ioredis';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';

/**
 * Audio feature provider interface
 * Each provider implements different audio analysis strategies
 */
export interface AudioFeatureProvider {
  name: string;
  priority: number; // Higher = preferred
  canAnalyze(track: TrackInfo): Promise<boolean>;
  analyze(track: TrackInfo): Promise<AudioFeatures | null>;
}

/**
 * Spotify Audio Features Provider
 * Best quality - uses Spotify's audio analysis API
 */
export class SpotifyAudioFeatures implements AudioFeatureProvider {
  name = 'spotify';
  priority = 100;

  async canAnalyze(track: TrackInfo): Promise<boolean> {
    if (track.source === 'spotify' && track.uri) {
      return true;
    }
    // TODO: Implement fuzzy matching for non-Spotify tracks
    return false;
  }

  async analyze(track: TrackInfo): Promise<AudioFeatures | null> {
    // TODO: Implement Spotify API integration
    // For now, return null (not implemented)
    return null;
  }
}

/**
 * Last.fm Analyzer
 * Uses Last.fm API for genre/tag information
 */
export class LastFMAnalyzer implements AudioFeatureProvider {
  name = 'lastfm';
  priority = 50;

  async canAnalyze(track: TrackInfo): Promise<boolean> {
    return Boolean(track.title && track.author);
  }

  async analyze(track: TrackInfo): Promise<AudioFeatures | null> {
    // TODO: Implement Last.fm API integration
    // For now, return null (not implemented)
    return null;
  }
}

/**
 * Metadata-based Estimator
 * Fallback that estimates features from title/author metadata
 */
export class MetadataEstimator implements AudioFeatureProvider {
  name = 'estimated';
  priority = 1;

  async canAnalyze(_track: TrackInfo): Promise<boolean> {
    return true; // Always available as fallback
  }

  async analyze(track: TrackInfo): Promise<AudioFeatures | null> {
    // Simple heuristic-based estimation
    const title = track.title.toLowerCase();
    const author = track.author?.toLowerCase() || '';

    // Estimate energy based on keywords
    let energy = 0.5;
    if (title.includes('remix') || title.includes('extended')) energy += 0.2;
    if (title.includes('acoustic') || title.includes('piano')) energy -= 0.2;
    if (title.includes('hard') || title.includes('metal')) energy += 0.3;

    // Estimate valence (happiness)
    let valence = 0.5;
    if (title.includes('sad') || title.includes('dark')) valence -= 0.3;
    if (title.includes('happy') || title.includes('joy')) valence += 0.3;

    // Estimate tempo
    let tempo = 120; // default BPM
    if (title.includes('slow') || title.includes('ballad')) tempo = 80;
    if (title.includes('fast') || title.includes('speed')) tempo = 160;

    // Genre estimation from keywords
    const genres: string[] = [];
    if (title.includes('edm') || title.includes('electronic')) genres.push('electronic');
    if (title.includes('rock')) genres.push('rock');
    if (title.includes('hip hop') || title.includes('rap')) genres.push('hip-hop');
    if (title.includes('jazz')) genres.push('jazz');
    if (title.includes('classical')) genres.push('classical');
    if (title.includes('metal')) genres.push('metal');
    if (title.includes('pop')) genres.push('pop');

    return {
      tempo: Math.max(60, Math.min(200, tempo)),
      energy: Math.max(0, Math.min(1, energy)),
      danceability: 0.5,
      valence: Math.max(0, Math.min(1, valence)),
      speechiness: 0.1,
      acousticness: title.includes('acoustic') ? 0.8 : 0.3,
      instrumentalness: title.includes('instrumental') ? 0.9 : 0.1,
      liveness: 0.2,
      genres,
      tags: [],
      provider: 'estimated',
    };
  }
}

/**
 * Audio Analyzer Service
 * Coordinates multiple providers to analyze tracks
 */
export class AudioAnalyzerService {
  private providers: AudioFeatureProvider[] = [];
  private readonly CACHE_TTL = 60 * 60 * 24 * 7; // 7 days

  constructor(
    private readonly redis: Redis,
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {
    // Register providers in priority order
    this.providers = [
      new SpotifyAudioFeatures(),
      new LastFMAnalyzer(),
      new MetadataEstimator(), // Always last (fallback)
    ].sort((a, b) => b.priority - a.priority);
  }

  /**
   * Generate consistent track ID from track info
   */
  private generateTrackId(track: TrackInfo): string {
    if (track.id) return track.id;

    const input = `${track.source}:${track.uri || track.title}:${track.author || ''}`;
    return crypto.createHash('sha256').update(input).digest('hex').substring(0, 32);
  }

  /**
   * Get audio features from cache (Redis or DB)
   */
  private async getFromCache(trackId: string): Promise<AudioFeatures | null> {
    // Try Redis first (faster)
    const cached = await this.redis.get(`audio:features:${trackId}`);
    if (cached) {
      try {
        return JSON.parse(cached) as AudioFeatures;
      } catch {
        // Invalid JSON, continue to DB
      }
    }

    // Try database
    const dbResult = await this.db
      .select()
      .from(schema.audioFeatures)
      .where(eq(schema.audioFeatures.trackId, trackId))
      .limit(1);

    if (dbResult.length > 0) {
      const row = dbResult[0]!;
      const features: AudioFeatures = {
        tempo: row.tempo ? Number(row.tempo) : undefined,
        energy: row.energy ? Number(row.energy) : undefined,
        danceability: row.danceability ? Number(row.danceability) : undefined,
        valence: row.valence ? Number(row.valence) : undefined,
        loudness: row.loudness ? Number(row.loudness) : undefined,
        speechiness: row.speechiness ? Number(row.speechiness) : undefined,
        acousticness: row.acousticness ? Number(row.acousticness) : undefined,
        instrumentalness: row.instrumentalness ? Number(row.instrumentalness) : undefined,
        liveness: row.liveness ? Number(row.liveness) : undefined,
        genres: row.genres || [],
        tags: row.tags || [],
        provider: row.provider as AudioFeatures['provider'],
        providerId: row.providerId || undefined,
      };

      // Update Redis cache
      await this.redis.setex(
        `audio:features:${trackId}`,
        this.CACHE_TTL,
        JSON.stringify(features),
      );

      return features;
    }

    return null;
  }

  /**
   * Store audio features in cache (Redis and DB)
   */
  private async storeInCache(trackId: string, features: AudioFeatures): Promise<void> {
    // Store in Redis
    await this.redis.setex(
      `audio:features:${trackId}`,
      this.CACHE_TTL,
      JSON.stringify(features),
    );

    // Store in DB
    await this.db
      .insert(schema.audioFeatures)
      .values({
        trackId,
        tempo: features.tempo ? features.tempo.toString() : null,
        energy: features.energy ? features.energy.toString() : null,
        danceability: features.danceability ? features.danceability.toString() : null,
        valence: features.valence ? features.valence.toString() : null,
        loudness: features.loudness ? features.loudness.toString() : null,
        speechiness: features.speechiness ? features.speechiness.toString() : null,
        acousticness: features.acousticness ? features.acousticness.toString() : null,
        instrumentalness: features.instrumentalness ? features.instrumentalness.toString() : null,
        liveness: features.liveness ? features.liveness.toString() : null,
        genres: features.genres,
        tags: features.tags,
        provider: features.provider || null,
        providerId: features.providerId || null,
        analyzedAt: new Date(),
        metadata: null,
      })
      .onConflictDoUpdate({
        target: schema.audioFeatures.trackId,
        set: {
          tempo: features.tempo ? features.tempo.toString() : null,
          energy: features.energy ? features.energy.toString() : null,
          danceability: features.danceability ? features.danceability.toString() : null,
          valence: features.valence ? features.valence.toString() : null,
          loudness: features.loudness ? features.loudness.toString() : null,
          speechiness: features.speechiness ? features.speechiness.toString() : null,
          acousticness: features.acousticness ? features.acousticness.toString() : null,
          instrumentalness: features.instrumentalness ? features.instrumentalness.toString() : null,
          liveness: features.liveness ? features.liveness.toString() : null,
          genres: features.genres,
          tags: features.tags,
          provider: features.provider || null,
          providerId: features.providerId || null,
          analyzedAt: new Date(),
        },
      });
  }

  /**
   * Analyze a track and return audio features
   * Uses cached results when available
   */
  async analyzeTrack(track: TrackInfo): Promise<AudioFeatures> {
    const trackId = this.generateTrackId(track);

    // Check cache first
    const cached = await this.getFromCache(trackId);
    if (cached) {
      return cached;
    }

    // Try providers in priority order
    for (const provider of this.providers) {
      const canAnalyze = await provider.canAnalyze(track);
      if (!canAnalyze) continue;

      try {
        const features = await provider.analyze(track);
        if (features) {
          // Store in cache for future use
          await this.storeInCache(trackId, features);
          return features;
        }
      } catch (error) {
        console.error(`Provider ${provider.name} failed to analyze track:`, error);
        // Continue to next provider
      }
    }

    // This should never happen as MetadataEstimator always succeeds
    throw new Error('All audio analysis providers failed');
  }

  /**
   * Analyze multiple tracks in parallel
   */
  async analyzeTracks(tracks: TrackInfo[]): Promise<Map<string, AudioFeatures>> {
    const results = await Promise.allSettled(
      tracks.map(async (track) => {
        const trackId = this.generateTrackId(track);
        const features = await this.analyzeTrack(track);
        return { trackId, features };
      }),
    );

    const map = new Map<string, AudioFeatures>();
    for (const result of results) {
      if (result.status === 'fulfilled') {
        map.set(result.value.trackId, result.value.features);
      }
    }

    return map;
  }
}
