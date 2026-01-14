import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { fetchGameMetadataBatch, SteamMetadataError } from '../steam.js';

describe('Steam API retry logic', () => {
  it('fetches successfully without retry', async () => {
    const mockFetch = mock.fn(async () => {
      return new Response(
        JSON.stringify({
          '123': {
            success: true,
            data: {
              name: 'Test Game',
              categories: [{ description: 'Multi-player' }],
            },
          },
        }),
        { status: 200 },
      );
    });

    global.fetch = mockFetch as any;

    const result = await fetchGameMetadataBatch([123]);

    assert.equal(mockFetch.mock.calls.length, 1);
    assert.equal(result.get(123)?.name, 'Test Game');
    assert.equal(result.get(123)?.isMultiplayer, true);
  });

  it('retries on 500 error then succeeds', async () => {
    let callCount = 0;
    const mockFetch = mock.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('Server Error', { status: 500 });
      }
      return new Response(
        JSON.stringify({
          '456': {
            success: true,
            data: {
              name: 'Retry Game',
              categories: [],
            },
          },
        }),
        { status: 200 },
      );
    });

    global.fetch = mockFetch as any;

    const result = await fetchGameMetadataBatch([456]);

    assert.equal(mockFetch.mock.calls.length, 2);
    assert.equal(result.get(456)?.name, 'Retry Game');
  });

  it('retries on 429 rate limit error then succeeds', async () => {
    let callCount = 0;
    const mockFetch = mock.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('Too Many Requests', { status: 429 });
      }
      return new Response(
        JSON.stringify({
          '789': {
            success: true,
            data: {
              name: 'Rate Limited Game',
              categories: [],
            },
          },
        }),
        { status: 200 },
      );
    });

    global.fetch = mockFetch as any;

    const result = await fetchGameMetadataBatch([789]);

    assert.equal(mockFetch.mock.calls.length, 2);
    assert.equal(result.get(789)?.name, 'Rate Limited Game');
  });

  it('exhausts max retry attempts on persistent 500 errors', async () => {
    const mockFetch = mock.fn(async () => {
      return new Response('Server Error', { status: 500 });
    });

    global.fetch = mockFetch as any;

    await assert.rejects(
      async () => await fetchGameMetadataBatch([999]),
      (error: Error) => {
        assert.ok(error instanceof SteamMetadataError);
        assert.equal(error.message, 'Steam appdetails failed with status 500');
        return true;
      },
    );

    assert.equal(mockFetch.mock.calls.length, 3);
  });

  it('does not retry on 404 client error', async () => {
    const mockFetch = mock.fn(async () => {
      return new Response('Not Found', { status: 404 });
    });

    global.fetch = mockFetch as any;

    await assert.rejects(
      async () => await fetchGameMetadataBatch([111]),
      (error: Error) => {
        assert.ok(error instanceof SteamMetadataError);
        assert.equal(error.message, 'Steam appdetails failed with status 404');
        return true;
      },
    );

    assert.equal(mockFetch.mock.calls.length, 1);
  });

  it('retries on network error then succeeds', async () => {
    let callCount = 0;
    const mockFetch = mock.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('Network error');
      }
      return new Response(
        JSON.stringify({
          '222': {
            success: true,
            data: {
              name: 'Network Retry Game',
              categories: [],
            },
          },
        }),
        { status: 200 },
      );
    });

    global.fetch = mockFetch as any;

    const result = await fetchGameMetadataBatch([222]);

    assert.equal(mockFetch.mock.calls.length, 2);
    assert.equal(result.get(222)?.name, 'Network Retry Game');
  });

  it('retries multiple times on persistent errors', async () => {
    let callCount = 0;

    const mockFetch = mock.fn(async () => {
      callCount++;
      if (callCount < 3) {
        return new Response('Server Error', { status: 500 });
      }
      return new Response(
        JSON.stringify({
          '333': {
            success: true,
            data: {
              name: 'Retry Game',
              categories: [],
            },
          },
        }),
        { status: 200 },
      );
    });

    global.fetch = mockFetch as any;

    const result = await fetchGameMetadataBatch([333]);

    assert.equal(mockFetch.mock.calls.length, 3);
    assert.equal(result.get(333)?.name, 'Retry Game');
  });

  it('handles empty app IDs array', async () => {
    const mockFetch = mock.fn();
    global.fetch = mockFetch as any;

    const result = await fetchGameMetadataBatch([]);

    assert.equal(mockFetch.mock.calls.length, 0);
    assert.equal(result.size, 0);
  });

  it('handles apps with no metadata', async () => {
    const mockFetch = mock.fn(async () => {
      return new Response(
        JSON.stringify({
          '444': {
            success: false,
          },
        }),
        { status: 200 },
      );
    });

    global.fetch = mockFetch as any;

    const result = await fetchGameMetadataBatch([444]);

    assert.equal(mockFetch.mock.calls.length, 1);
    assert.equal(result.get(444), null);
  });

  it('handles batch of multiple app IDs', async () => {
    const mockFetch = mock.fn(async () => {
      return new Response(
        JSON.stringify({
          '100': {
            success: true,
            data: {
              name: 'Game 1',
              categories: [{ description: 'PvP' }],
            },
          },
          '200': {
            success: true,
            data: {
              name: 'Game 2',
              categories: [],
            },
          },
          '300': {
            success: false,
          },
        }),
        { status: 200 },
      );
    });

    global.fetch = mockFetch as any;

    const result = await fetchGameMetadataBatch([100, 200, 300]);

    assert.equal(mockFetch.mock.calls.length, 1);
    assert.equal(result.size, 3);
    assert.equal(result.get(100)?.name, 'Game 1');
    assert.equal(result.get(100)?.isMultiplayer, true);
    assert.equal(result.get(200)?.name, 'Game 2');
    assert.equal(result.get(200)?.isMultiplayer, false);
    assert.equal(result.get(300), null);
  });
});
