const timers = new Map<
  string,
  { interval: NodeJS.Timeout; timeout: NodeJS.Timeout; deadline: number }
>();

export function scheduleSessionClock(
  sessionId: string,
  deadlineMs: number,
  onTick: (remainingSeconds: number) => void,
  onExpire: () => void,
) {
  clearSessionClock(sessionId);

  const tick = () => {
    const remainingSeconds = Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
    onTick(remainingSeconds);
  };

  // run first tick immediately so Activity has reference time
  tick();

  const interval = setInterval(tick, 1000);
  const timeoutDelay = Math.max(0, deadlineMs - Date.now());
  const timeout = setTimeout(() => {
    clearSessionClock(sessionId);
    onExpire();
  }, timeoutDelay);

  timers.set(sessionId, { interval, timeout, deadline: deadlineMs });
}

export function clearSessionClock(sessionId: string) {
  const entry = timers.get(sessionId);
  if (!entry) {
    return;
  }
  clearInterval(entry.interval);
  clearTimeout(entry.timeout);
  timers.delete(sessionId);
}

export function getSessionDeadline(sessionId: string) {
  return timers.get(sessionId)?.deadline ?? null;
}
