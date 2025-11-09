import { inArray } from 'drizzle-orm';
import type { GameMetadata } from '@tonedial/shared';
import { db, schema } from '../db/client.js';
import { fetchGameMetadata } from './steam.js';

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
      updatedAt: row.updatedAt?.toISOString() ?? new Date().toISOString(),
    });
  });

  const missing = uniqueIds.filter((id) => !existingMap.has(id));
  if (missing.length) {
    for (const appId of missing) {
      try {
        const metadata = await fetchGameMetadata(appId);
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
      } catch (error) {
        console.error(`Failed to fetch metadata for ${appId}`, error);
      }
    }
  }

  return existingMap;
}
