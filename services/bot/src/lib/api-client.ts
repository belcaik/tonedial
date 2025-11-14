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
