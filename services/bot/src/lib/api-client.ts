import type {
  CreateSessionPayload,
  RouletteClosePayload,
  RouletteGameCandidate,
  RouletteResult,
  RouletteSessionSnapshot,
  RouletteVotePayload,
  SteamLinkStatus,
  SteamOwnedResponse,
} from '@tonedial/shared';
import { debugLog } from './debug.js';

const API_BASE_URL = deriveApiBaseUrl();

function deriveApiBaseUrl() {
  const internalHost = process.env.API_INTERNAL_HOST ?? 'api';
  const internalPort = process.env.API_PORT ?? '8080';
  const internalDefault = `http://${internalHost}:${internalPort}`;

  const candidates = [
    process.env.API_BASE_URL,
    process.env.API_INTERNAL_URL,
    internalDefault,
    process.env.API_ORIGIN,
    process.env.API_PUBLIC_BASE_URL,
    process.env.API_PUBLIC_URL,
    process.env.PUBLIC_API_URL,
    process.env.PUBLIC_ORIGIN,
    (() => {
      const raw = process.env.STEAM_RETURN_URL;
      if (!raw) {
        return null;
      }
      try {
        return new URL(raw).origin;
      } catch {
        return null;
      }
    })(),
    internalDefault,
  ];

  for (const candidate of candidates) {
    if (candidate && candidate.trim()) {
      return candidate.replace(/\/$/, '');
    }
  }
  return internalDefault;
}

async function apiFetch<T>(path: string, init?: RequestInit) {
  let response: Response;
  const url = `${API_BASE_URL}${path}`;
  debugLog('API request', { url, method: init?.method ?? 'GET' });
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    debugLog('API request failed before response', { url, reason });
    throw new Error(`Failed to reach API at ${url}: ${reason}`);
  }

  if (!response.ok) {
    debugLog('API request returned non-OK', { url, status: response.status });
    let errorMessage = `API request failed (${response.status})`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data?.error) {
        errorMessage = data.error;
      }
    } catch {
      const text = await response.text();
      if (text) {
        errorMessage = text;
      }
    }
    throw new Error(errorMessage);
  }

  const json = (await response.json()) as T;
  debugLog('API request succeeded', { url });
  return json;
}

export function getSteamOwnedGames(steamId64: string, force = false) {
  const suffix = force ? '?force=true' : '';
  return apiFetch<SteamOwnedResponse>(`/steam/owned/${steamId64}${suffix}`);
}

export function getSteamLinkStatus(userId: string) {
  return apiFetch<SteamLinkStatus>(`/steam/link/${userId}`);
}

export function createRouletteSession(payload: CreateSessionPayload) {
  return apiFetch<{
    sessionId: string;
    token: string;
    expiresAt?: string;
    deadline: string;
    pool: RouletteGameCandidate[];
  }>(`/roulette/session`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function requestActivityToken(sessionId: string, userId?: string) {
  return apiFetch<{ token: string; exp?: number }>(`/activity/session-token`, {
    method: 'POST',
    body: JSON.stringify({ sessionId, userId }),
  });
}

export function submitRouletteVote(payload: RouletteVotePayload) {
  return apiFetch<{ ok: boolean }>(`/roulette/vote`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function closeRoulette(payload: RouletteClosePayload) {
  return apiFetch<RouletteResult>(`/roulette/close`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchRouletteSession(sessionId: string) {
  return apiFetch<RouletteSessionSnapshot>(`/roulette/session/${sessionId}`);
}

// ============================================================
// Radio API Functions
// ============================================================

export interface RadioSettings {
  enabled: boolean;
  algorithm: 'similarity' | 'genre' | 'mixed';
  similarityThreshold: number;
  genreDiversity: number;
  tempoVariance: number;
  energyVariance: number;
  historyLookbackHours: number;
  minQueueSize: number;
  maxQueueSize: number;
  avoidRepeatHours: number;
}

export interface TrackInfo {
  id: string;
  title: string;
  author?: string;
  duration?: number;
  uri?: string;
  source: 'youtube' | 'soundcloud' | 'bandcamp' | 'http' | 'spotify';
}

export interface PlaybackEvent {
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
}

/**
 * Get radio settings for a guild
 */
export function getRadioSettings(guildId: string) {
  return apiFetch<{ settings: RadioSettings }>(`/radio/settings/${guildId}`);
}

/**
 * Update radio settings for a guild
 */
export function updateRadioSettings(guildId: string, settings: Partial<RadioSettings>) {
  return apiFetch<{ success: boolean; settings: RadioSettings }>(`/radio/settings/${guildId}`, {
    method: 'POST',
    body: JSON.stringify(settings),
  });
}

/**
 * Start radio for a guild
 */
export function startRadio(guildId: string, algorithm: RadioSettings['algorithm'] = 'similarity') {
  return apiFetch<{ success: boolean; enabled: boolean; algorithm: string }>(
    `/radio/start/${guildId}`,
    {
      method: 'POST',
      body: JSON.stringify({ enabled: true, algorithm }),
    },
  );
}

/**
 * Stop radio for a guild
 */
export function stopRadio(guildId: string) {
  return apiFetch<{ success: boolean; enabled: boolean }>(`/radio/stop/${guildId}`, {
    method: 'POST',
  });
}

/**
 * Get next track from radio queue
 */
export function getNextRadioTrack(guildId: string) {
  return apiFetch<{ trackId: string | null; message?: string }>(`/radio/next/${guildId}`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/**
 * Generate radio recommendations
 */
export function generateRadioRecommendations(
  guildId: string,
  candidateTracks: TrackInfo[],
  count: number = 5,
) {
  return apiFetch<{
    recommendations: Array<{
      track: TrackInfo;
      score: number;
      reason: string;
    }>;
    count: number;
  }>(`/radio/recommendations/${guildId}`, {
    method: 'POST',
    body: JSON.stringify({ candidateTracks, count }),
  });
}

/**
 * Track a playback event
 */
export function trackPlayback(guildId: string, event: PlaybackEvent) {
  return apiFetch<{ success: boolean; message: string }>(`/radio/playback/${guildId}`, {
    method: 'POST',
    body: JSON.stringify(event),
  });
}

/**
 * Get playback history
 */
export function getPlaybackHistory(guildId: string, hours: number = 24) {
  return apiFetch<{ history: string[]; count: number; hours: number }>(
    `/radio/history/${guildId}?hours=${hours}`,
  );
}
