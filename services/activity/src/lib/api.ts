import type { RouletteResult, RouletteSessionSnapshot } from '@tonedial/shared';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080';

async function authedFetch<T>(path: string, token: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `API request failed (${response.status})`);
  }

  return (await response.json()) as T;
}

export function requestSessionToken(sessionId: string, userId?: string) {
  return fetch(`${API_BASE_URL}/activity/session-token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, userId }),
  }).then(async (res) => {
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Failed to request session token');
    }
    return (await res.json()) as { token: string; exp?: number };
  });
}

export function fetchSessionSnapshot(sessionId: string, token: string) {
  return authedFetch<RouletteSessionSnapshot>(`/roulette/session/${sessionId}`, token);
}

export function submitSecretVote(
  payload: { sessionId: string; userId: string; appId: number },
  token: string,
) {
  return authedFetch<{ ok: boolean }>(`/roulette/vote`, token, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function closeSession(payload: { sessionId: string; requestedBy: string }, token: string) {
  return authedFetch<RouletteResult>(`/roulette/close`, token, {
    method: 'POST',
    body: JSON.stringify({ ...payload, action: 'close' }),
  });
}
