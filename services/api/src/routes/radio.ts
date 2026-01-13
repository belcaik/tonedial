import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RadioSettings } from '@tonedial/shared';
import { radioSettingsSchema } from '@tonedial/shared';
import type { AudioAnalyzerService } from '../services/audio-analyzer.service.js';
import type { SimilarityEngine } from '../services/similarity-engine.service.js';
import type { RadioQueueManager } from '../services/radio-queue.service.js';

interface RadioRouteParams {
  guildId: string;
}

interface RadioStartBody {
  enabled: boolean;
  algorithm?: 'similarity' | 'genre' | 'mixed';
}

interface RadioRecommendationsBody {
  candidateTracks: Array<{
    id: string;
    title: string;
    author?: string;
    duration?: number;
    uri?: string;
    source: 'youtube' | 'soundcloud' | 'bandcamp' | 'http' | 'spotify';
  }>;
  count?: number;
}

export async function radioRoutes(
  fastify: FastifyInstance,
  options: {
    audioAnalyzer: AudioAnalyzerService;
    similarityEngine: SimilarityEngine;
    radioQueue: RadioQueueManager;
  },
) {
  const { audioAnalyzer, similarityEngine, radioQueue } = options;

  /**
   * GET /radio/settings/:guildId
   * Get radio settings for a guild
   */
  fastify.get<{
    Params: RadioRouteParams;
  }>('/radio/settings/:guildId', async (request, reply) => {
    const { guildId } = request.params;

    try {
      const settings = await radioQueue.getRadioSettings(guildId);
      return reply.send({ settings });
    } catch (error) {
      request.log.error({ error, guildId }, 'Failed to get radio settings');
      return reply.status(500).send({
        error: 'Failed to get radio settings',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /radio/settings/:guildId
   * Update radio settings for a guild
   */
  fastify.post<{
    Params: RadioRouteParams;
    Body: Partial<RadioSettings>;
  }>('/radio/settings/:guildId', async (request, reply) => {
    const { guildId } = request.params;
    const settings = request.body;

    try {
      // Validate settings
      const validated = radioSettingsSchema.partial().parse(settings);
      const sanitized = Object.fromEntries(
        Object.entries(validated).filter(([, value]) => value !== undefined),
      ) as Partial<RadioSettings>;

      await radioQueue.updateRadioSettings(guildId, sanitized);

      return reply.send({
        success: true,
        settings: await radioQueue.getRadioSettings(guildId),
      });
    } catch (error) {
      request.log.error({ error, guildId, settings }, 'Failed to update radio settings');
      return reply.status(400).send({
        error: 'Invalid radio settings',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /radio/start/:guildId
   * Enable radio for a guild
   */
  fastify.post<{
    Params: RadioRouteParams;
    Body: RadioStartBody;
  }>('/radio/start/:guildId', async (request, reply) => {
    const { guildId } = request.params;
    const { enabled, algorithm } = request.body;

    try {
      await radioQueue.updateRadioSettings(guildId, {
        enabled: enabled ?? true,
        algorithm: algorithm ?? 'similarity',
      });

      const state = await radioQueue.getRadioState(guildId);
      const settings = await radioQueue.getRadioSettings(guildId);

      return reply.send({
        success: true,
        enabled: settings.enabled,
        algorithm: settings.algorithm,
        state,
      });
    } catch (error) {
      request.log.error({ error, guildId }, 'Failed to start radio');
      return reply.status(500).send({
        error: 'Failed to start radio',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /radio/stop/:guildId
   * Disable radio for a guild
   */
  fastify.post<{
    Params: RadioRouteParams;
  }>('/radio/stop/:guildId', async (request, reply) => {
    const { guildId } = request.params;

    try {
      await radioQueue.updateRadioSettings(guildId, { enabled: false });
      await radioQueue.clearQueue(guildId);

      return reply.send({ success: true, enabled: false });
    } catch (error) {
      request.log.error({ error, guildId }, 'Failed to stop radio');
      return reply.status(500).send({
        error: 'Failed to stop radio',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /radio/queue/:guildId
   * Get current radio queue
   */
  fastify.get<{
    Params: RadioRouteParams;
  }>('/radio/queue/:guildId', async (request, reply) => {
    const { guildId } = request.params;

    try {
      const queue = await radioQueue.getQueue(guildId);
      const queueSize = await radioQueue.getQueueSize(guildId);
      const state = await radioQueue.getRadioState(guildId);

      return reply.send({
        queue,
        size: queueSize,
        state,
      });
    } catch (error) {
      request.log.error({ error, guildId }, 'Failed to get radio queue');
      return reply.status(500).send({
        error: 'Failed to get radio queue',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /radio/recommendations/:guildId
   * Generate radio recommendations
   */
  fastify.post<{
    Params: RadioRouteParams;
    Body: RadioRecommendationsBody;
  }>('/radio/recommendations/:guildId', async (request, reply) => {
    const { guildId } = request.params;
    const { candidateTracks, count = 5 } = request.body;

    try {
      if (!candidateTracks || candidateTracks.length === 0) {
        return reply.status(400).send({
          error: 'No candidate tracks provided',
        });
      }

      const recommendations = await radioQueue.generateRecommendations(
        guildId,
        candidateTracks,
        count,
      );

      return reply.send({
        recommendations: recommendations.map((r) => ({
          track: r.trackInfo,
          score: r.score,
          reason: r.reason,
        })),
        count: recommendations.length,
      });
    } catch (error) {
      request.log.error({ error, guildId }, 'Failed to generate recommendations');
      return reply.status(500).send({
        error: 'Failed to generate recommendations',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /radio/history/:guildId
   * Get playback history for a guild
   */
  fastify.get<{
    Params: RadioRouteParams;
    Querystring: { hours?: number };
  }>('/radio/history/:guildId', async (request, reply) => {
    const { guildId } = request.params;
    const { hours = 24 } = request.query;

    try {
      const history = await radioQueue.getRecentHistory(guildId, hours);

      return reply.send({
        history,
        count: history.length,
        hours,
      });
    } catch (error) {
      request.log.error({ error, guildId }, 'Failed to get playback history');
      return reply.status(500).send({
        error: 'Failed to get playback history',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /radio/next/:guildId
   * Get next track from queue (pops it)
   */
  fastify.post<{
    Params: RadioRouteParams;
  }>('/radio/next/:guildId', async (request, reply) => {
    const { guildId } = request.params;

    try {
      const nextTrackId = await radioQueue.popNextTrack(guildId);

      if (!nextTrackId) {
        return reply.send({
          track: null,
          message: 'Queue is empty',
        });
      }

      return reply.send({
        trackId: nextTrackId,
      });
    } catch (error) {
      request.log.error({ error, guildId }, 'Failed to get next track');
      return reply.status(500).send({
        error: 'Failed to get next track',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /radio/state/:guildId
   * Get current radio state
   */
  fastify.get<{
    Params: RadioRouteParams;
  }>('/radio/state/:guildId', async (request, reply) => {
    const { guildId } = request.params;

    try {
      const state = await radioQueue.getRadioState(guildId);
      const settings = await radioQueue.getRadioSettings(guildId);
      const queueSize = await radioQueue.getQueueSize(guildId);

      return reply.send({
        state,
        settings,
        queueSize,
      });
    } catch (error) {
      request.log.error({ error, guildId }, 'Failed to get radio state');
      return reply.status(500).send({
        error: 'Failed to get radio state',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /radio/playback/:guildId
   * Track playback event for analytics and recommendations
   */
  fastify.post<{
    Params: RadioRouteParams;
    Body: {
      trackId: string;
      trackTitle: string;
      trackAuthor?: string;
      trackDuration?: number;
      trackUri?: string;
      trackSource: 'youtube' | 'soundcloud' | 'bandcamp' | 'http' | 'spotify';
      requestedBy: string;
      completionRate?: number;
      skipped?: boolean;
      skipReason?: 'user' | 'error' | 'stuck';
      audioFeatures?: Record<string, unknown>;
    };
  }>('/radio/playback/:guildId', async (request, reply) => {
    const { guildId } = request.params;
    const playbackData = request.body;

    try {
      await radioQueue.trackPlayback(guildId, playbackData);

      return reply.send({
        success: true,
        message: 'Playback tracked successfully',
      });
    } catch (error) {
      request.log.error({ error, guildId, playbackData }, 'Failed to track playback');
      return reply.status(500).send({
        error: 'Failed to track playback',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
