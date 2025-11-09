import type {
  CreateSessionPayload,
  RouletteClosePayload,
  RouletteResult,
  RouletteSessionSnapshot,
  RouletteVotePayload,
  SteamOwnedResponse,
} from '@tonedial/shared';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://api:8080';

async function apiFetch<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
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

  return (await response.json()) as T;
}

export function getSteamOwnedGames(steamId64: string, force = false) {
  const suffix = force ? '?force=true' : '';
  return apiFetch<SteamOwnedResponse>(`/steam/owned/${steamId64}${suffix}`);
}

export function createRouletteSession(payload: CreateSessionPayload) {
  return apiFetch<{ sessionId: string; token: string }>(`/roulette/session`, {
    method: 'POST',
    body: JSON.stringify(payload),
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
