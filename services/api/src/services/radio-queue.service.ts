import type { AudioFeatures, RadioSettings, TrackInfo } from '@tonedial/shared';
import type { Redis } from 'ioredis';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import type { AudioAnalyzerService } from './audio-analyzer.service.js';
import type { SimilarityEngine } from './similarity-engine.service.js';

interface RadioState {
  active: boolean;
  currentTrack: string | null;
  isRadioTrack: boolean;
  startedAt: string | null;
  algorithm: string;
}

interface QueueEntry {
  trackInfo: TrackInfo;
  score: number;
  reason: string; // Why this track was selected
}

/**
 * Radio Queue Manager
 * Manages intelligent radio queue with similarity-based selection
 */
export class RadioQueueManager {
  private readonly QUEUE_KEY_PREFIX = 'radio:queue:';
  private readonly STATE_KEY_PREFIX = 'radio:state:';
  private readonly RECOMMENDATIONS_KEY_PREFIX = 'radio:recommendations:';
  private readonly RECOMMENDATIONS_TTL = 300; // 5 minutes

  constructor(
    private readonly redis: Redis,
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly audioAnalyzer: AudioAnalyzerService,
    private readonly similarityEngine: SimilarityEngine,
  ) {}

  /**
   * Get radio settings for a guild (with defaults)
   */
  async getRadioSettings(guildId: string): Promise<RadioSettings> {
    const result = await this.db
      .select()
      .from(schema.guildRadioSettings)
      .where(eq(schema.guildRadioSettings.guildId, guildId))
      .limit(1);

    if (result.length === 0) {
      // Return defaults
      return {
        enabled: false,
        algorithm: 'similarity',
        similarityThreshold: 0.7,
        genreDiversity: 0.3,
        tempoVariance: 20,
        energyVariance: 0.2,
        historyLookbackHours: 24,
        minQueueSize: 3,
        maxQueueSize: 10,
        avoidRepeatHours: 2,
      };
    }

    const row = result[0]!;
    return {
      enabled: row.enabled ?? false,
      algorithm: (row.algorithm as RadioSettings['algorithm']) ?? 'similarity',
      similarityThreshold: Number(row.similarityThreshold) ?? 0.7,
      genreDiversity: Number(row.genreDiversity) ?? 0.3,
      tempoVariance: row.tempoVariance ?? 20,
      energyVariance: Number(row.energyVariance) ?? 0.2,
      historyLookbackHours: row.historyLookbackHours ?? 24,
      minQueueSize: row.minQueueSize ?? 3,
      maxQueueSize: row.maxQueueSize ?? 10,
      avoidRepeatHours: row.avoidRepeatHours ?? 2,
    };
  }

  /**
   * Update radio settings for a guild
   */
  async updateRadioSettings(guildId: string, settings: Partial<RadioSettings>): Promise<void> {
    await this.db
      .insert(schema.guildRadioSettings)
      .values({
        guildId,
        enabled: settings.enabled ?? null,
        algorithm: settings.algorithm ?? null,
        similarityThreshold: settings.similarityThreshold ? settings.similarityThreshold.toString() : null,
        genreDiversity: settings.genreDiversity ? settings.genreDiversity.toString() : null,
        tempoVariance: settings.tempoVariance ?? null,
        energyVariance: settings.energyVariance ? settings.energyVariance.toString() : null,
        historyLookbackHours: settings.historyLookbackHours ?? null,
        minQueueSize: settings.minQueueSize ?? null,
        maxQueueSize: settings.maxQueueSize ?? null,
        avoidRepeatHours: settings.avoidRepeatHours ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.guildRadioSettings.guildId,
        set: {
          enabled: settings.enabled ?? null,
          algorithm: settings.algorithm ?? null,
          similarityThreshold: settings.similarityThreshold ? settings.similarityThreshold.toString() : null,
          genreDiversity: settings.genreDiversity ? settings.genreDiversity.toString() : null,
          tempoVariance: settings.tempoVariance ?? null,
          energyVariance: settings.energyVariance ? settings.energyVariance.toString() : null,
          historyLookbackHours: settings.historyLookbackHours ?? null,
          minQueueSize: settings.minQueueSize ?? null,
          maxQueueSize: settings.maxQueueSize ?? null,
          avoidRepeatHours: settings.avoidRepeatHours ?? null,
          updatedAt: new Date(),
        },
      });

    // Clear recommendations cache
    await this.redis.del(`${this.RECOMMENDATIONS_KEY_PREFIX}${guildId}`);
  }

  /**
   * Get recent playback history for a guild
   */
  async getRecentHistory(guildId: string, hours: number = 24): Promise<string[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const results = await this.db
      .select({ trackId: schema.playbackHistory.trackId })
      .from(schema.playbackHistory)
      .where(
        and(
          eq(schema.playbackHistory.guildId, guildId),
          gte(schema.playbackHistory.playedAt, since),
        ),
      )
      .orderBy(desc(schema.playbackHistory.playedAt));

    return results.map((r) => r.trackId);
  }

  /**
   * Get radio state for a guild
   */
  async getRadioState(guildId: string): Promise<RadioState | null> {
    const stateKey = `${this.STATE_KEY_PREFIX}${guildId}`;
    const state = await this.redis.get(stateKey);

    if (!state) return null;

    try {
      return JSON.parse(state) as RadioState;
    } catch {
      return null;
    }
  }

  /**
   * Set radio state for a guild
   */
  async setRadioState(guildId: string, state: RadioState): Promise<void> {
    const stateKey = `${this.STATE_KEY_PREFIX}${guildId}`;
    await this.redis.setex(stateKey, 60 * 60, JSON.stringify(state)); // 1 hour TTL
  }

  /**
   * Get current queue for a guild
   */
  async getQueue(guildId: string): Promise<TrackInfo[]> {
    const queueKey = `${this.QUEUE_KEY_PREFIX}${guildId}`;
    const trackIds = await this.redis.lrange(queueKey, 0, -1);

    if (trackIds.length === 0) return [];

    // TODO: Fetch full track info from cache/DB
    // For now, return empty array (track info needs to be stored separately)
    return [];
  }

  /**
   * Add tracks to queue
   */
  async addToQueue(guildId: string, tracks: TrackInfo[]): Promise<void> {
    if (tracks.length === 0) return;

    const queueKey = `${this.QUEUE_KEY_PREFIX}${guildId}`;
    const trackIds = tracks.map((t) => t.id);

    await this.redis.rpush(queueKey, ...trackIds);
    await this.redis.expire(queueKey, 60 * 60 * 24); // 24 hour TTL
  }

  /**
   * Get next track from queue
   */
  async popNextTrack(guildId: string): Promise<string | null> {
    const queueKey = `${this.QUEUE_KEY_PREFIX}${guildId}`;
    return await this.redis.lpop(queueKey);
  }

  /**
   * Clear queue for a guild
   */
  async clearQueue(guildId: string): Promise<void> {
    const queueKey = `${this.QUEUE_KEY_PREFIX}${guildId}`;
    await this.redis.del(queueKey);
  }

  /**
   * Get queue size
   */
  async getQueueSize(guildId: string): Promise<number> {
    const queueKey = `${this.QUEUE_KEY_PREFIX}${guildId}`;
    return await this.redis.llen(queueKey);
  }

  /**
   * Generate radio recommendations based on recent history
   */
  async generateRecommendations(
    guildId: string,
    candidateTracks: TrackInfo[],
    count: number = 5,
  ): Promise<QueueEntry[]> {
    const settings = await this.getRadioSettings(guildId);

    if (!settings.enabled) {
      throw new Error('Radio is not enabled for this guild');
    }

    // Get recent history to avoid repeats
    const recentHistory = await this.getRecentHistory(guildId, settings.avoidRepeatHours);
    const recentSet = new Set(recentHistory);

    // Filter out recently played tracks
    const availableCandidates = candidateTracks.filter((t) => !recentSet.has(t.id));

    if (availableCandidates.length === 0) {
      throw new Error('No available tracks for radio (all recently played)');
    }

    // Get recent tracks for similarity comparison (last 5 unique tracks)
    const recentTrackIds = [...new Set(recentHistory)].slice(0, 5);

    if (recentTrackIds.length === 0) {
      // No history - return random tracks
      const shuffled = availableCandidates.sort(() => Math.random() - 0.5);
      return shuffled.slice(0, count).map((track) => ({
        trackInfo: track,
        score: 0.5,
        reason: 'random (no history)',
      }));
    }

    // Calculate recommendations based on algorithm
    switch (settings.algorithm) {
      case 'similarity':
        return await this.generateSimilarityBasedRecommendations(
          guildId,
          availableCandidates,
          recentTrackIds,
          settings,
          count,
        );

      case 'genre':
        return await this.generateGenreBasedRecommendations(
          guildId,
          availableCandidates,
          recentTrackIds,
          settings,
          count,
        );

      case 'mixed':
        return await this.generateMixedRecommendations(
          guildId,
          availableCandidates,
          recentTrackIds,
          settings,
          count,
        );

      default:
        throw new Error(`Unknown radio algorithm: ${settings.algorithm}`);
    }
  }

  /**
   * Similarity-based recommendations
   */
  private async generateSimilarityBasedRecommendations(
    guildId: string,
    candidates: TrackInfo[],
    recentTrackIds: string[],
    settings: RadioSettings,
    count: number,
  ): Promise<QueueEntry[]> {
    // Calculate average features of recent tracks
    const recentFeatures = await Promise.all(
      recentTrackIds.map((id) => {
        const track = candidates.find((c) => c.id === id);
        if (!track) return null;
        return this.audioAnalyzer.analyzeTrack(track);
      }),
    );

    const validFeatures = recentFeatures.filter((f): f is AudioFeatures => f !== null);

    if (validFeatures.length === 0) {
      // Fallback to random
      const shuffled = candidates.sort(() => Math.random() - 0.5);
      return shuffled.slice(0, count).map((track) => ({
        trackInfo: track,
        score: 0.5,
        reason: 'random (no valid features)',
      }));
    }

    // Calculate average features
    const avgFeatures = this.calculateAverageFeatures(validFeatures);

    // Create a synthetic "target" track for comparison
    const targetTrack: TrackInfo = {
      id: 'radio-target',
      title: 'Radio Target',
      source: 'youtube',
      audioFeatures: avgFeatures,
    };

    // Find similar tracks
    const similarTracks = await this.similarityEngine.findSimilarTracks(targetTrack, candidates, {
      limit: count * 2, // Get more than needed for diversity
      minScore: settings.similarityThreshold,
    });

    // Add diversity - don't pick all top similar tracks
    const selected: QueueEntry[] = [];
    const diversityFactor = settings.genreDiversity;

    for (let i = 0; i < Math.min(count, similarTracks.length); i++) {
      // Apply diversity: sometimes skip top picks
      if (Math.random() > diversityFactor || i === 0) {
        const similar = similarTracks[i]!;
        selected.push({
          trackInfo: similar.track,
          score: similar.score,
          reason: `similar (${(similar.score * 100).toFixed(0)}%)`,
        });
      } else {
        // Pick a random track from remaining candidates
        const randomIdx = Math.floor(Math.random() * (similarTracks.length - i)) + i;
        const similar = similarTracks[randomIdx]!;
        selected.push({
          trackInfo: similar.track,
          score: similar.score * 0.8, // Penalize random picks slightly
          reason: 'diverse pick',
        });
      }
    }

    return selected;
  }

  /**
   * Genre-based recommendations
   */
  private async generateGenreBasedRecommendations(
    guildId: string,
    candidates: TrackInfo[],
    recentTrackIds: string[],
    settings: RadioSettings,
    count: number,
  ): Promise<QueueEntry[]> {
    // Get recent track features
    const recentFeatures = await Promise.all(
      recentTrackIds.map((id) => {
        const track = candidates.find((c) => c.id === id);
        if (!track) return null;
        return this.audioAnalyzer.analyzeTrack(track);
      }),
    );

    const validFeatures = recentFeatures.filter((f): f is AudioFeatures => f !== null);

    // Collect all genres from recent tracks
    const genreCounts = new Map<string, number>();
    for (const features of validFeatures) {
      for (const genre of features.genres || []) {
        genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
      }
    }

    // Sort genres by frequency
    const topGenres = [...genreCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([genre]) => genre)
      .slice(0, 3);

    if (topGenres.length === 0) {
      // No genres found - fallback to random
      const shuffled = candidates.sort(() => Math.random() - 0.5);
      return shuffled.slice(0, count).map((track) => ({
        trackInfo: track,
        score: 0.5,
        reason: 'random (no genres)',
      }));
    }

    // Find tracks with matching genres
    const genreMatches = await Promise.all(
      candidates.map(async (track) => {
        const features = await this.audioAnalyzer.analyzeTrack(track);
        const matchingGenres = (features.genres || []).filter((g) => topGenres.includes(g));
        const score = matchingGenres.length / topGenres.length;

        return {
          track,
          score,
          matchingGenres,
        };
      }),
    );

    // Sort by score and take top N
    const sorted = genreMatches
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, count);

    return sorted.map((match) => ({
      trackInfo: match.track,
      score: match.score,
      reason: `genre: ${match.matchingGenres.join(', ')}`,
    }));
  }

  /**
   * Mixed recommendations (similarity + genre + random)
   */
  private async generateMixedRecommendations(
    guildId: string,
    candidates: TrackInfo[],
    recentTrackIds: string[],
    settings: RadioSettings,
    count: number,
  ): Promise<QueueEntry[]> {
    const similarCount = Math.ceil(count * 0.5); // 50% similar
    const genreCount = Math.ceil(count * 0.3); // 30% genre-based
    const randomCount = count - similarCount - genreCount; // 20% random

    const [similar, genre] = await Promise.all([
      this.generateSimilarityBasedRecommendations(
        guildId,
        candidates,
        recentTrackIds,
        settings,
        similarCount,
      ),
      this.generateGenreBasedRecommendations(
        guildId,
        candidates,
        recentTrackIds,
        settings,
        genreCount,
      ),
    ]);

    // Add some random picks for serendipity
    const usedIds = new Set([...similar.map((s) => s.trackInfo.id), ...genre.map((g) => g.trackInfo.id)]);
    const remaining = candidates.filter((c) => !usedIds.has(c.id));
    const shuffled = remaining.sort(() => Math.random() - 0.5);
    const random = shuffled.slice(0, randomCount).map((track) => ({
      trackInfo: track,
      score: 0.5,
      reason: 'random (serendipity)',
    }));

    // Interleave results for variety
    const mixed: QueueEntry[] = [];
    const maxLength = Math.max(similar.length, genre.length, random.length);

    for (let i = 0; i < maxLength; i++) {
      if (i < similar.length) mixed.push(similar[i]!);
      if (i < genre.length) mixed.push(genre[i]!);
      if (i < random.length) mixed.push(random[i]!);
    }

    return mixed.slice(0, count);
  }

  /**
   * Calculate average audio features from multiple tracks
   */
  private calculateAverageFeatures(features: AudioFeatures[]): AudioFeatures {
    const count = features.length;

    const avg: AudioFeatures = {
      tempo: 0,
      energy: 0,
      danceability: 0,
      valence: 0,
      loudness: 0,
      speechiness: 0,
      acousticness: 0,
      instrumentalness: 0,
      liveness: 0,
      genres: [],
      tags: [],
    };

    let tempoSum = 0,
      tempoCount = 0;
    let energySum = 0,
      energyCount = 0;
    let danceSum = 0,
      danceCount = 0;
    let valenceSum = 0,
      valenceCount = 0;
    let loudnessSum = 0,
      loudnessCount = 0;

    const genreSet = new Set<string>();

    for (const f of features) {
      if (f.tempo !== undefined) {
        tempoSum += f.tempo;
        tempoCount++;
      }
      if (f.energy !== undefined) {
        energySum += f.energy;
        energyCount++;
      }
      if (f.danceability !== undefined) {
        danceSum += f.danceability;
        danceCount++;
      }
      if (f.valence !== undefined) {
        valenceSum += f.valence;
        valenceCount++;
      }
      if (f.loudness !== undefined) {
        loudnessSum += f.loudness;
        loudnessCount++;
      }

      for (const genre of f.genres || []) {
        genreSet.add(genre);
      }
    }

    avg.tempo = tempoCount > 0 ? tempoSum / tempoCount : undefined;
    avg.energy = energyCount > 0 ? energySum / energyCount : undefined;
    avg.danceability = danceCount > 0 ? danceSum / danceCount : undefined;
    avg.valence = valenceCount > 0 ? valenceSum / valenceCount : undefined;
    avg.loudness = loudnessCount > 0 ? loudnessSum / loudnessCount : undefined;
    avg.genres = [...genreSet];

    return avg;
  }

  /**
   * Check if queue needs refilling and refill if necessary
   */
  async maintainQueue(guildId: string, candidateTracks: TrackInfo[]): Promise<void> {
    const settings = await this.getRadioSettings(guildId);

    if (!settings.enabled) {
      return;
    }

    const currentSize = await this.getQueueSize(guildId);

    if (currentSize >= settings.minQueueSize) {
      return; // Queue is sufficiently filled
    }

    // Generate recommendations to refill queue
    const needed = settings.maxQueueSize - currentSize;
    const recommendations = await this.generateRecommendations(guildId, candidateTracks, needed);

    await this.addToQueue(
      guildId,
      recommendations.map((r) => r.trackInfo),
    );
  }

  /**
   * Track playback event for analytics and recommendations
   */
  async trackPlayback(
    guildId: string,
    playbackData: {
      trackId: string;
      trackTitle: string;
      trackAuthor?: string;
      trackDuration?: number;
      trackUri?: string;
      trackSource: string;
      requestedBy: string;
      completionRate?: number;
      skipped?: boolean;
      skipReason?: string;
      audioFeatures?: Record<string, unknown>;
    },
  ): Promise<void> {
    // Insert into playback history
    await this.db.insert(schema.playbackHistory).values({
      guildId,
      trackId: playbackData.trackId,
      trackTitle: playbackData.trackTitle,
      trackAuthor: playbackData.trackAuthor || null,
      trackDuration: playbackData.trackDuration || null,
      trackUri: playbackData.trackUri || null,
      trackSource: playbackData.trackSource,
      requestedBy: playbackData.requestedBy,
      playedAt: new Date(),
      completionRate: playbackData.completionRate ? playbackData.completionRate.toString() : null,
      skipped: playbackData.skipped ?? false,
      skipReason: playbackData.skipReason || null,
      audioFeatures: playbackData.audioFeatures || null,
    });
  }
}
