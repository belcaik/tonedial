const DEBUG_ENABLED = /^true$/i.test(process.env.ROULETTE_DEBUG ?? '');

export function debugLog(label: string, payload?: unknown) {
  if (!DEBUG_ENABLED) {
    return;
  }

  if (typeof payload === 'undefined') {
    console.debug(`[roulette] ${label}`);
    return;
  }

  console.debug(`[roulette] ${label}`, payload);
}

export function isDebugEnabled() {
  return DEBUG_ENABLED;
}
