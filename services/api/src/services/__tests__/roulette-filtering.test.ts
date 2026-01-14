import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('roulette filtering logic', () => {
  // This test simulates the filtering logic from roulette.ts line 95:
  // if (metadata && !metadata.isMultiplayer) { continue; }
  // The logic should only exclude games that have metadata confirming they are NOT multiplayer

  it('excludes games with metadata where isMultiplayer is false', () => {
    const candidates = [
      { appId: 1, name: 'Single Player Game' },
      { appId: 2, name: 'Another Single Player' },
    ];

    const metadataMap = new Map<number, { name: string; isMultiplayer: boolean }>([
      [1, { name: 'Single Player Game', isMultiplayer: false }],
      [2, { name: 'Another Single Player', isMultiplayer: false }],
    ]);

    const filtered = [];
    for (const candidate of candidates) {
      const metadata = metadataMap.get(candidate.appId);
      // Permissive filtering: only exclude if metadata exists AND confirms single-player
      if (metadata && !metadata.isMultiplayer) {
        continue;
      }
      filtered.push(candidate);
    }

    assert.equal(filtered.length, 0, 'should exclude games confirmed as single-player');
  });

  it('includes games with metadata where isMultiplayer is true', () => {
    const candidates = [
      { appId: 10, name: 'Multiplayer Game A' },
      { appId: 20, name: 'Multiplayer Game B' },
    ];

    const metadataMap = new Map<number, { name: string; isMultiplayer: boolean }>([
      [10, { name: 'Multiplayer Game A', isMultiplayer: true }],
      [20, { name: 'Multiplayer Game B', isMultiplayer: true }],
    ]);

    const filtered = [];
    for (const candidate of candidates) {
      const metadata = metadataMap.get(candidate.appId);
      if (metadata && !metadata.isMultiplayer) {
        continue;
      }
      filtered.push(candidate);
    }

    assert.equal(filtered.length, 2, 'should include all multiplayer games');
    assert.equal(filtered[0].appId, 10);
    assert.equal(filtered[1].appId, 20);
  });

  it('includes games without metadata (permissive approach)', () => {
    const candidates = [
      { appId: 100, name: 'Game Without Metadata' },
      { appId: 200, name: 'Another Unknown Game' },
      { appId: 300, name: 'Third Unknown Game' },
    ];

    // Empty metadata map - no metadata available for any games
    const metadataMap = new Map<number, { name: string; isMultiplayer: boolean }>();

    const filtered = [];
    for (const candidate of candidates) {
      const metadata = metadataMap.get(candidate.appId);
      // Permissive filtering: games without metadata should pass through
      if (metadata && !metadata.isMultiplayer) {
        continue;
      }
      filtered.push(candidate);
    }

    assert.equal(filtered.length, 3, 'should include all games without metadata');
    assert.equal(filtered[0].appId, 100);
    assert.equal(filtered[1].appId, 200);
    assert.equal(filtered[2].appId, 300);
  });

  it('correctly handles mixed scenario with some metadata available', () => {
    const candidates = [
      { appId: 1, name: 'Single Player' },
      { appId: 2, name: 'Multiplayer' },
      { appId: 3, name: 'Unknown Game' },
      { appId: 4, name: 'Another Unknown' },
    ];

    const metadataMap = new Map<number, { name: string; isMultiplayer: boolean }>([
      [1, { name: 'Single Player', isMultiplayer: false }],
      [2, { name: 'Multiplayer', isMultiplayer: true }],
      // appId 3 and 4 have no metadata
    ]);

    const filtered = [];
    for (const candidate of candidates) {
      const metadata = metadataMap.get(candidate.appId);
      if (metadata && !metadata.isMultiplayer) {
        continue;
      }
      filtered.push(candidate);
    }

    // Should include: appId 2 (multiplayer), appId 3 (no metadata), appId 4 (no metadata)
    // Should exclude: appId 1 (confirmed single-player)
    assert.equal(filtered.length, 3, 'should filter correctly in mixed scenario');
    assert.equal(filtered[0].appId, 2, 'should include confirmed multiplayer game');
    assert.equal(filtered[1].appId, 3, 'should include game without metadata');
    assert.equal(filtered[2].appId, 4, 'should include second game without metadata');
  });
});
