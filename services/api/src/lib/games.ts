import { inArray } from 'drizzle-orm';
import type { GameMetadata } from '@tonedial/shared';
import { db, schema } from '../db/client.js';
import { fetchGameMetadataBatch, SteamMetadataError } from './steam.js';

export async function ensureGamesMetadata(appIds: number[]): Promise<Map<number, GameMetadata>> {
  const uniqueIds = Array.from(new Set(appIds));
  if (!uniqueIds.length) {
    return new Map();
  }

  const existing = await db
    .select()
    .from(schema.games)
    .where(inArray(schema.games.appId, uniqueIds));

  const existingMap = new Map<number, GameMetadata>();
  existing.forEach((row) => {
    existingMap.set(row.appId, {
      appId: row.appId,
      name: row.name,
      categories: row.categories,
      isMultiplayer: row.isMultiplayer,
      maxPlayers: row.maxPlayers ?? undefined,
      headerImageUrl: getSteamHeaderImageUrl(row.appId),
      updatedAt: row.updatedAt?.toISOString() ?? new Date().toISOString(),
    });
  });

  const missing = uniqueIds.filter((id) => !existingMap.has(id));
  if (missing.length) {
    const chunks = chunkArray(missing, 20);
    for (const chunk of chunks) {
      let attempt = 0;
      while (attempt < 3) {
        try {
          const batch = await fetchGameMetadataBatch(chunk);
          for (const [appId, metadata] of batch.entries()) {
            if (!metadata) {
              continue;
            }
            existingMap.set(appId, metadata);
            await db
              .insert(schema.games)
              .values({
                appId: metadata.appId,
                name: metadata.name,
                categories: metadata.categories,
                isMultiplayer: metadata.isMultiplayer,
                maxPlayers: metadata.maxPlayers ?? null,
                updatedAt: new Date(metadata.updatedAt),
              })
              .onConflictDoUpdate({
                target: schema.games.appId,
                set: {
                  name: metadata.name,
                  categories: metadata.categories,
                  isMultiplayer: metadata.isMultiplayer,
                  maxPlayers: metadata.maxPlayers ?? null,
                  updatedAt: new Date(metadata.updatedAt),
                },
              });
          }
          break;
        } catch (error) {
          const status = error instanceof SteamMetadataError ? error.status : undefined;
          if (status === 429 && attempt < 2) {
            const delay = 500 * (attempt + 1);
            await wait(delay);
            attempt++;
            continue;
          }
          console.error('Failed to fetch metadata batch', { chunk, error });
          break;
        }
      }
    }
  }

  return existingMap;
}

function chunkArray<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    result.push(values.slice(i, i + size));
  }
  return result;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSteamHeaderImageUrl(appId: number): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;
}
