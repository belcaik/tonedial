import { steamOwnedResponseSchema, type GameMetadata } from '@tonedial/shared';
import { env } from '../env.js';
import { redis } from './redis.js';

const OWNED_GAMES_TTL_SECONDS = 60 * 60 * 24; // 24h
const OWNED_CACHE_PREFIX = 'cache:steam:owned:';
const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';
const STEAM_API_HOST = 'https://api.steampowered.com';
const STEAM_STORE_API = 'https://store.steampowered.com/api/appdetails';

export type OpenIdPayload = Record<string, string | string[]>;

export async function verifySteamOpenId(payload: OpenIdPayload) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'undefined') {
      continue;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => params.append(key, entry));
    } else {
      params.append(key, value);
    }
  }

  params.set('openid.mode', 'check_authentication');

  const response = await fetch(STEAM_OPENID_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`Steam OpenID validation failed with status ${response.status}`);
  }

  const text = await response.text();
  if (!text.includes('is_valid:true')) {
    throw new Error('Steam OpenID validation rejected payload');
  }

  const claimedId = extractField(payload['openid.claimed_id']);
  if (!claimedId) {
    throw new Error('Missing claimed_id in OpenID payload');
  }

  return extractSteamIdFromClaimedId(claimedId);
}

function extractField(value: string | string[] | undefined) {
  if (!value) {
    return undefined;
  }
  return Array.isArray(value) ? value[0] : value;
}

export function extractSteamIdFromClaimedId(claimedId: string) {
  const segments = claimedId.split('/');
  const steamId = segments[segments.length - 1];
  if (!steamId || !/^\d+$/.test(steamId)) {
    throw new Error('Invalid claimed_id format');
  }
  return steamId;
}

export type OwnedGame = {
  appid: number;
  name: string;
  playtime_forever: number;
};

export type OwnedGamesPayload = {
  steamId64: string;
  visibilityOk: boolean;
  games: OwnedGame[];
  fetchedAt: string;
};

export async function getOwnedGames(steamId64: string, force = false): Promise<OwnedGamesPayload> {
  const cacheKey = `${OWNED_CACHE_PREFIX}${steamId64}`;

  if (!force) {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = steamOwnedResponseSchema.safeParse(JSON.parse(cached));
      if (parsed.success) {
        return parsed.data;
      }
    }
  }

  if (!env.STEAM_API_KEY) {
    throw new Error('STEAM_API_KEY is not set; cannot fetch owned games');
  }

  const url = new URL('/IPlayerService/GetOwnedGames/v0001/', STEAM_API_HOST);
  url.searchParams.set('key', env.STEAM_API_KEY);
  url.searchParams.set('steamid', steamId64);
  url.searchParams.set('include_appinfo', '1');
  url.searchParams.set('include_played_free_games', '1');

  const response = await fetch(url, { headers: { 'User-Agent': 'ToneDial/1.0' } });
  if (!response.ok) {
    throw new Error(`Steam owned games request failed with status ${response.status}`);
  }

  const json = (await response.json()) as {
    response?: { games?: OwnedGame[]; game_count?: number };
  };

  const games = json.response?.games ?? [];
  const payload: OwnedGamesPayload = {
    steamId64,
    visibilityOk: Array.isArray(json.response?.games) && typeof json.response?.game_count === 'number',
    games,
    fetchedAt: new Date().toISOString(),
  };

  await redis.set(cacheKey, JSON.stringify(payload), 'EX', OWNED_GAMES_TTL_SECONDS);

  return payload;
}

const MULTIPLAYER_TAGS = new Set([
  'Multi-player',
  'Online Co-op',
  'Local Co-op',
  'Local Multi-Player',
  'Cross-Platform Multiplayer',
  'Massively Multiplayer',
  'PvP',
  'PvE',
  'LAN Co-op',
  'LAN PvP',
  'Shared/Split Screen',
  'Shared/Split Screen PvP',
]);

export async function fetchGameMetadata(appId: number): Promise<GameMetadata> {
  const url = new URL(STEAM_STORE_API);
  url.searchParams.set('appids', String(appId));
  url.searchParams.set('filters', 'basic,categories,genres');

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Steam appdetails failed with status ${response.status}`);
  }

  const json = (await response.json()) as Record<string, { success: boolean; data?: any }>;
  const entry = json[String(appId)];
  if (!entry?.success || !entry.data) {
    throw new Error(`Steam app ${appId} not found`);
  }

  const categories = Array.isArray(entry.data.categories)
    ? entry.data.categories.map((cat: { description: string }) => cat.description)
    : [];

  const isMultiplayer = categories.some((category: string) => MULTIPLAYER_TAGS.has(category));

  return {
    appId,
    name: entry.data.name,
    categories,
    isMultiplayer,
    maxPlayers: undefined,
    updatedAt: new Date().toISOString(),
  };
}
