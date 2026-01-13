/**
 * Service initialization and dependency injection
 */
import { Redis } from 'ioredis';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AudioAnalyzerService } from './audio-analyzer.service.js';
import { SimilarityEngine } from './similarity-engine.service.js';
import { RadioQueueManager } from './radio-queue.service.js';
import { env } from '../env.js';
import * as schema from '../db/schema.js';

let redisClient: Redis | null = null;
let audioAnalyzerService: AudioAnalyzerService | null = null;
let similarityEngineService: SimilarityEngine | null = null;
let radioQueueService: RadioQueueManager | null = null;

/**
 * Initialize Redis client
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, {
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
    });

    redisClient.on('error', (err) => {
      console.error('Redis error:', err);
    });

    redisClient.on('connect', () => {
      console.info('Redis connected');
    });
  }

  return redisClient;
}

/**
 * Initialize all radio services
 */
export function initializeRadioServices(db: PostgresJsDatabase<typeof schema>) {
  const redis = getRedisClient();

  // Initialize Audio Analyzer
  audioAnalyzerService = new AudioAnalyzerService(redis, db);

  // Initialize Similarity Engine (depends on Audio Analyzer)
  similarityEngineService = new SimilarityEngine(redis, db, audioAnalyzerService);

  // Initialize Radio Queue Manager (depends on both)
  radioQueueService = new RadioQueueManager(
    redis,
    db,
    audioAnalyzerService,
    similarityEngineService,
  );

  console.info('Radio services initialized');

  return {
    audioAnalyzer: audioAnalyzerService,
    similarityEngine: similarityEngineService,
    radioQueue: radioQueueService,
  };
}

/**
 * Get Audio Analyzer service instance
 */
export function getAudioAnalyzer(): AudioAnalyzerService {
  if (!audioAnalyzerService) {
    throw new Error('Audio analyzer service not initialized');
  }
  return audioAnalyzerService;
}

/**
 * Get Similarity Engine service instance
 */
export function getSimilarityEngine(): SimilarityEngine {
  if (!similarityEngineService) {
    throw new Error('Similarity engine service not initialized');
  }
  return similarityEngineService;
}

/**
 * Get Radio Queue Manager service instance
 */
export function getRadioQueue(): RadioQueueManager {
  if (!radioQueueService) {
    throw new Error('Radio queue service not initialized');
  }
  return radioQueueService;
}

/**
 * Cleanup all services
 */
export async function cleanupServices(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }

  audioAnalyzerService = null;
  similarityEngineService = null;
  radioQueueService = null;

  console.info('Services cleaned up');
}
