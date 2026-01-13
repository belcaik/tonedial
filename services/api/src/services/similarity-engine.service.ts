import type { AudioFeatures, TrackInfo, TrackSimilarity } from '@tonedial/shared';
import type { Redis } from 'ioredis';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq, gte, or } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import type { AudioAnalyzerService } from './audio-analyzer.service.js';

const ALGORITHM_VERSION = 'v1.0.0';

/**
 * Feature weights for similarity calculation
 * Determines importance of each audio feature
 */
interface SimilarityWeights {
  tempo: number;
  energy: number;
  danceability: number;
  valence: number;
  genre: number;
  acousticness: number;
  instrumentalness: number;
}

const DEFAULT_WEIGHTS: SimilarityWeights = {
  tempo: 0.15,
  energy: 0.20,
  danceability: 0.15,
  valence: 0.15,
  genre: 0.25,
  acousticness: 0.05,
  instrumentalness: 0.05,
};

export interface SimilarTrack {
  track: TrackInfo;
  score: number;
  featuresMatched: Record<string, number>;
}

/**
 * Similarity Engine Service
 * Calculates and caches track similarity scores
 */
export class SimilarityEngine {
  private readonly CACHE_TTL = 60 * 60 * 24 * 30; // 30 days
  private readonly MIN_SCORE_THRESHOLD = 0.1; // Don't store very low scores

  constructor(
    private readonly redis: Redis,
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly audioAnalyzer: AudioAnalyzerService,
    private readonly weights: SimilarityWeights = DEFAULT_WEIGHTS,
  ) {}

  /**
   * Calculate similarity between two sets of audio features
   */
  calculateSimilarity(
    featuresA: AudioFeatures,
    featuresB: AudioFeatures,
  ): { score: number; featuresMatched: Record<string, number> } {
    let totalScore = 0;
    const featuresMatched: Record<string, number> = {};

    // Tempo similarity (normalized by variance)
    if (featuresA.tempo !== undefined && featuresB.tempo !== undefined) {
      const tempoDiff = Math.abs(featuresA.tempo - featuresB.tempo);
      const tempoSim = 1 - Math.min(tempoDiff / 50, 1); // 50 BPM max difference
      const weighted = tempoSim * this.weights.tempo;
      totalScore += weighted;
      featuresMatched.tempo = tempoSim;
    }

    // Energy similarity
    if (featuresA.energy !== undefined && featuresB.energy !== undefined) {
      const energyDiff = Math.abs(featuresA.energy - featuresB.energy);
      const energySim = 1 - energyDiff;
      const weighted = energySim * this.weights.energy;
      totalScore += weighted;
      featuresMatched.energy = energySim;
    }

    // Danceability similarity
    if (featuresA.danceability !== undefined && featuresB.danceability !== undefined) {
      const danceDiff = Math.abs(featuresA.danceability - featuresB.danceability);
      const danceSim = 1 - danceDiff;
      const weighted = danceSim * this.weights.danceability;
      totalScore += weighted;
      featuresMatched.danceability = danceSim;
    }

    // Valence similarity (mood)
    if (featuresA.valence !== undefined && featuresB.valence !== undefined) {
      const valenceDiff = Math.abs(featuresA.valence - featuresB.valence);
      const valenceSim = 1 - valenceDiff;
      const weighted = valenceSim * this.weights.valence;
      totalScore += weighted;
      featuresMatched.valence = valenceSim;
    }

    // Acousticness similarity
    if (featuresA.acousticness !== undefined && featuresB.acousticness !== undefined) {
      const acousticDiff = Math.abs(featuresA.acousticness - featuresB.acousticness);
      const acousticSim = 1 - acousticDiff;
      const weighted = acousticSim * this.weights.acousticness;
      totalScore += weighted;
      featuresMatched.acousticness = acousticSim;
    }

    // Instrumentalness similarity
    if (featuresA.instrumentalness !== undefined && featuresB.instrumentalness !== undefined) {
      const instrumentalDiff = Math.abs(featuresA.instrumentalness - featuresB.instrumentalness);
      const instrumentalSim = 1 - instrumentalDiff;
      const weighted = instrumentalSim * this.weights.instrumentalness;
      totalScore += weighted;
      featuresMatched.instrumentalness = instrumentalSim;
    }

    // Genre similarity (Jaccard index)
    if (featuresA.genres && featuresB.genres) {
      const genresA = new Set(featuresA.genres);
      const genresB = new Set(featuresB.genres);
      const intersection = [...genresA].filter((g) => genresB.has(g)).length;
      const union = new Set([...genresA, ...genresB]).size;
      const genreSim = union > 0 ? intersection / union : 0;
      const weighted = genreSim * this.weights.genre;
      totalScore += weighted;
      featuresMatched.genre = genreSim;
    }

    return {
      score: Math.min(totalScore, 1.0),
      featuresMatched,
    };
  }

  /**
   * Get cached similarity from Redis or DB
   */
  private async getCachedSimilarity(
    trackAId: string,
    trackBId: string,
  ): Promise<TrackSimilarity | null> {
    // Normalize order (always store A < B lexicographically)
    const sorted = [trackAId, trackBId].sort();
    const idA: string = sorted[0]!;
    const idB: string = sorted[1]!;

    // Try Redis first
    const cacheKey = `similarity:${idA}:${idB}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as TrackSimilarity;
      } catch {
        // Invalid JSON, continue to DB
      }
    }

    // Try database
    const dbResult = await this.db
      .select()
      .from(schema.trackSimilarity)
      .where(
        and(
          eq(schema.trackSimilarity.trackAId, idA),
          eq(schema.trackSimilarity.trackBId, idB),
          eq(schema.trackSimilarity.algorithmVersion, ALGORITHM_VERSION),
        ),
      )
      .limit(1);

    if (dbResult.length > 0) {
      const row = dbResult[0]!;
      const similarity: TrackSimilarity = {
        trackAId: row.trackAId,
        trackBId: row.trackBId,
        score: Number(row.similarityScore),
        featuresMatched: (row.featuresMatched as Record<string, number>) || undefined,
      };

      // Update Redis cache
      await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(similarity));

      return similarity;
    }

    return null;
  }

  /**
   * Store similarity in cache (Redis and DB)
   */
  private async storeSimilarity(
    trackAId: string,
    trackBId: string,
    score: number,
    featuresMatched: Record<string, number>,
  ): Promise<void> {
    // Don't store very low scores
    if (score < this.MIN_SCORE_THRESHOLD) {
      return;
    }

    // Normalize order
    const sorted = [trackAId, trackBId].sort();
    const idA: string = sorted[0]!;
    const idB: string = sorted[1]!;

    const similarity: TrackSimilarity = {
      trackAId: idA,
      trackBId: idB,
      score,
      featuresMatched,
    };

    // Store in Redis
    const cacheKey = `similarity:${idA}:${idB}`;
    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(similarity));

    // Store in DB
    await this.db
      .insert(schema.trackSimilarity)
      .values({
        trackAId: idA,
        trackBId: idB,
        similarityScore: score.toFixed(2),
        algorithmVersion: ALGORITHM_VERSION,
        calculatedAt: new Date(),
        featuresMatched: featuresMatched as any,
      })
      .onConflictDoUpdate({
        target: [schema.trackSimilarity.trackAId, schema.trackSimilarity.trackBId],
        set: {
          similarityScore: score.toFixed(2),
          algorithmVersion: ALGORITHM_VERSION,
          calculatedAt: new Date(),
          featuresMatched: featuresMatched as any,
        },
      });
  }

  /**
   * Calculate similarity between two tracks
   * Uses cache when available
   */
  async calculateTrackSimilarity(
    trackA: TrackInfo,
    trackB: TrackInfo,
    trackAId?: string,
    trackBId?: string,
  ): Promise<TrackSimilarity> {
    const idA: string = trackAId ?? trackA.id;
    const idB: string = trackBId ?? trackB.id;

    // Check cache first
    const cached = await this.getCachedSimilarity(idA, idB);
    if (cached) {
      return cached;
    }

    // Analyze both tracks
    const [featuresA, featuresB] = await Promise.all([
      this.audioAnalyzer.analyzeTrack(trackA),
      this.audioAnalyzer.analyzeTrack(trackB),
    ]);

    // Calculate similarity
    const { score, featuresMatched } = this.calculateSimilarity(featuresA, featuresB);

    // Store in cache
    await this.storeSimilarity(idA, idB, score, featuresMatched);

    return {
      trackAId: idA,
      trackBId: idB,
      score,
      featuresMatched,
    };
  }

  /**
   * Find similar tracks from a pool of candidates
   */
  async findSimilarTracks(
    baseTrack: TrackInfo,
    candidates: TrackInfo[],
    options: {
      limit?: number;
      minScore?: number;
      baseTrackId?: string;
    } = {},
  ): Promise<SimilarTrack[]> {
    const { limit = 10, minScore = 0.3, baseTrackId } = options;

    // Calculate similarities in parallel
    const similarities = await Promise.all(
      candidates.map(async (candidate) => {
        const similarity = await this.calculateTrackSimilarity(
          baseTrack,
          candidate,
          baseTrackId,
          candidate.id,
        );

        return {
          track: candidate,
          score: similarity.score,
          featuresMatched: similarity.featuresMatched ?? {},
        };
      }),
    );

    // Filter by min score and sort by score descending
    return similarities
      .filter((s) => s.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Get most similar tracks from database
   * Useful for finding recommendations from previously calculated similarities
   */
  async getSimilarTracksFromCache(
    trackId: string,
    options: {
      limit?: number;
      minScore?: number;
    } = {},
  ): Promise<string[]> {
    const { limit = 10, minScore = 0.3 } = options;

    const results = await this.db
      .select()
      .from(schema.trackSimilarity)
      .where(
        and(
          or(
            eq(schema.trackSimilarity.trackAId, trackId),
            eq(schema.trackSimilarity.trackBId, trackId),
          ),
          gte(schema.trackSimilarity.similarityScore, minScore.toFixed(2)),
          eq(schema.trackSimilarity.algorithmVersion, ALGORITHM_VERSION),
        ),
      )
      .orderBy(schema.trackSimilarity.similarityScore)
      .limit(limit);

    // Extract the "other" track ID
    return results.map((row) =>
      row.trackAId === trackId ? row.trackBId : row.trackAId,
    );
  }

  /**
   * Batch calculate similarities for multiple track pairs
   * Useful for pre-computing similarity matrix
   */
  async batchCalculateSimilarities(
    tracks: TrackInfo[],
    options: {
      minScore?: number;
    } = {},
  ): Promise<Map<string, Map<string, number>>> {
    const { minScore = 0.1 } = options;
    const matrix = new Map<string, Map<string, number>>();

    // Calculate all pairs
    for (let i = 0; i < tracks.length; i++) {
      const trackA = tracks[i]!;
      const similarities = new Map<string, number>();

      for (let j = i + 1; j < tracks.length; j++) {
        const trackB = tracks[j]!;
        const similarity = await this.calculateTrackSimilarity(trackA, trackB);

        if (similarity.score >= minScore) {
          similarities.set(trackB.id, similarity.score);

          // Also store reverse mapping
          if (!matrix.has(trackB.id)) {
            matrix.set(trackB.id, new Map());
          }
          matrix.get(trackB.id)!.set(trackA.id, similarity.score);
        }
      }

      if (similarities.size > 0) {
        matrix.set(trackA.id, similarities);
      }
    }

    return matrix;
  }
}
