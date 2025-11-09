const activeSessions = new Map<string, string>();

export function setActiveSession(guildId: string, sessionId: string) {
  activeSessions.set(guildId, sessionId);
}

export function getActiveSession(guildId: string) {
  return activeSessions.get(guildId) ?? null;
}

export function clearActiveSession(guildId: string) {
  activeSessions.delete(guildId);
}
