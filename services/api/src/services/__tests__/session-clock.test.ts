import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleSessionClock, clearSessionClock } from '../session-clock.js';

describe('session clock', () => {
  it('emits tick events before expiring', async () => {
    const ticks: number[] = [];
    await new Promise<void>((resolve) => {
      scheduleSessionClock(
        'test-session',
        Date.now() + 50,
        (remaining) => ticks.push(remaining),
        () => resolve(),
      );
    });
    assert.ok(ticks.length > 0, 'should receive tick callbacks');
  });

  it('can be cleared before expiry', async () => {
    let expired = false;
    scheduleSessionClock(
      'clear-session',
      Date.now() + 25,
      () => undefined,
      () => {
        expired = true;
      },
    );
    clearSessionClock('clear-session');
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(expired, false);
  });
});
