type ActiveSessionMeta = {
  id: string;
  expiresAt?: string;
};

const activeSessions = new Map<string, ActiveSessionMeta>();

export function setActiveSession(guildId: string, sessionId: string, expiresAt?: string) {
  const meta: ActiveSessionMeta = expiresAt ? { id: sessionId, expiresAt } : { id: sessionId };
  activeSessions.set(guildId, meta);
}

export function getActiveSession(guildId: string) {
  return activeSessions.get(guildId)?.id ?? null;
}

export function getActiveSessionMeta(guildId: string) {
  return activeSessions.get(guildId) ?? null;
}

export function clearActiveSession(guildId: string) {
  activeSessions.delete(guildId);
}
