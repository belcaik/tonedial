import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { RouletteGameCandidate, RouletteResult, RouletteSessionSnapshot } from '@tonedial/shared';
import { closeSession, fetchSessionSnapshot, requestSessionToken, submitSecretVote } from './lib/api';
import type { DiscordClient, DiscordContext } from './lib/discord';
import './styles.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080';

type EnrichedSnapshot = RouletteSessionSnapshot & {
  serverTime: string;
  ownerId?: string;
};

type AppProps = {
  discord?: { sdk: DiscordClient; ctx: DiscordContext };
  fallbackError?: string;
};

type Identity = {
  userId: string;
  viaDiscord: boolean;
};

type DeadlineSync = {
  endsAt: number;
};

export default function App({ discord, fallbackError }: AppProps) {
  const params = new URLSearchParams(window.location.search);
  const initialSessionId = params.get('sid') ?? params.get('sessionId') ?? '';
  const urlToken = params.get('token');

  const [sessionId] = useState(initialSessionId);
  const [token, setToken] = useState<string | null>(urlToken);
  const [snapshot, setSnapshot] = useState<EnrichedSnapshot | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [winner, setWinner] = useState<RouletteResult | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(() =>
    discord?.ctx.user?.id ? { userId: discord.ctx.user.id, viaDiscord: true } : null,
  );
  const [manualUserId, setManualUserId] = useState('');
  const [userVotes, setUserVotes] = useState(0);
  const [submitted, setSubmitted] = useState<Record<number, boolean>>({});
  const [slotItems, setSlotItems] = useState<string[]>([]);
  const [isSpinning, setIsSpinning] = useState(false);
  const slotTrackRef = useRef<HTMLDivElement | null>(null);
  const [sseLost, setSseLost] = useState(false);
  const deadlineRef = useRef<DeadlineSync | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (discord?.ctx.user?.id) {
      setIdentity({ userId: discord.ctx.user.id, viaDiscord: true });
    }
  }, [discord?.ctx.user?.id]);

  useEffect(() => {
    if (!sessionId) {
      setStatusMessage('Missing session identifier. Add ?sid=SESSION_ID to the URL.');
      return;
    }

    if (!identity?.userId && !urlToken) {
      setStatusMessage('Waiting for Discord context or manual identity.');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const response = await requestSessionToken(sessionId, identity?.userId);
        if (cancelled) {
          return;
        }
        setToken(response.token);
        setStatusMessage(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (urlToken) {
          setToken(urlToken);
          setStatusMessage('Using fallback token provided by the launcher.');
          return;
        }
        setStatusMessage((error as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [identity?.userId, sessionId, urlToken]);

  useEffect(() => {
    if (!token || !sessionId) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = (await fetchSessionSnapshot(sessionId, token)) as EnrichedSnapshot;
        if (cancelled) {
          return;
        }
        setSnapshot(data);
        setStatusMessage(null);
        syncDeadline(data.deadline, data.serverTime);
      } catch (error) {
        if (!cancelled) {
          setStatusMessage((error as Error).message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, token]);

  const triggerClose = useCallback(async () => {
    if (!snapshot || !token || !identity?.userId) {
      return;
    }
    try {
      await closeSession({ sessionId: snapshot.sessionId, requestedBy: identity.userId }, token);
    } catch (error) {
      setStatusMessage((error as Error).message);
    }
  }, [identity?.userId, snapshot, token]);

  useEffect(() => {
    if (!token || !sessionId) {
      return;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const source = new EventSource(`${API_BASE_URL}/roulette/${sessionId}/stream?token=${encodeURIComponent(token)}`);
    eventSourceRef.current = source;

    source.addEventListener('session.created', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as EnrichedSnapshot;
      setSnapshot(payload);
      setWinner(null);
      syncDeadline(payload.deadline, payload.serverTime);
    });

    source.addEventListener('session.updated', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        sessionId: string;
        remainingSeconds: number;
      };
      setRemainingSeconds(payload.remainingSeconds);
      if (payload.remainingSeconds <= 0 && snapshot?.ownerId === identity?.userId) {
        void triggerClose();
      }
    });

    source.addEventListener('session.tick', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        remainingSeconds: number;
        serverTime: string;
      };
      syncDeadline(undefined, payload.serverTime, payload.remainingSeconds);
    });

    source.addEventListener('session.closed', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as RouletteResult;
      setWinner(payload);
      setStatusMessage(`Winner selected: app ${payload.appId}`);
    });

    source.onerror = () => {
      setSseLost(true);
      source.close();
    };

    return () => {
      source.close();
      eventSourceRef.current = null;
    };
  }, [identity?.userId, sessionId, snapshot?.ownerId, token, triggerClose]);

  useEffect(() => {
    if (!winner || !snapshot) {
      return;
    }
    const winningCandidate = snapshot.pool.find((candidate) => candidate.appId === winner.appId);
    if (!winningCandidate) {
      return;
    }
    const filler = shuffle(
      snapshot.pool.map((candidate) => candidate.name).filter((name) => name !== winningCandidate.name),
    ).slice(0, 6);
    setSlotItems([...filler, winningCandidate.name]);
    setIsSpinning(true);
    const timeout = window.setTimeout(() => setIsSpinning(false), 3200);
    return () => window.clearTimeout(timeout);
  }, [snapshot, winner]);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!isSpinning || !slotTrackRef.current) {
      if (slotTrackRef.current) {
        slotTrackRef.current.style.transform = 'translateY(0)';
      }
      return;
    }
    if (prefersReducedMotion) {
      slotTrackRef.current.style.transform = 'translateY(0)';
      return;
    }
    const track = slotTrackRef.current;
    const totalDistance = Math.max(0, slotItems.length - 1) * 64;
    const duration = 2800;
    let start: number | null = null;
    let frame: number;

    const step = (timestamp: number) => {
      if (start === null) {
        start = timestamp;
      }
      const progress = Math.min(1, (timestamp - start) / duration);
      const eased = easeOutCubic(progress);
      track.style.transform = `translateY(-${totalDistance * eased}px)`;
      if (progress < 1) {
        frame = requestAnimationFrame(step);
      }
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [isSpinning, slotItems]);

  const proposalsLeft = useMemo(() => {
    if (!snapshot) {
      return 0;
    }
    return Math.max(0, snapshot.rules.maxProposals - userVotes);
  }, [snapshot, userVotes]);

  const filteredCandidates = useMemo(() => {
    if (!snapshot) {
      return [];
    }
    return snapshot.pool;
  }, [snapshot]);

  const identityReady = Boolean(identity?.userId);
  const disableVoting = !identityReady || !snapshot || proposalsLeft === 0 || remainingSeconds === 0 || Boolean(winner);
  const isOwner = snapshot?.ownerId === identity?.userId;

  const handleManualIdentity = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!manualUserId.trim()) {
      return;
    }
    setIdentity({ userId: manualUserId.trim(), viaDiscord: false });
  };

  const handleProposal = useCallback(
    async (candidate: RouletteGameCandidate) => {
      if (!snapshot || !identity?.userId || !token) {
        return;
      }
      setStatusMessage('Submitting proposal...');
      try {
        await submitSecretVote({ sessionId: snapshot.sessionId, userId: identity.userId, appId: candidate.appId }, token);
        setSubmitted((prev) => ({ ...prev, [candidate.appId]: true }));
        setUserVotes((prev) => prev + 1);
        setStatusMessage('Proposal submitted.');
      } catch (error) {
        setStatusMessage((error as Error).message);
      }
    },
    [identity?.userId, snapshot, token],
  );

  const syncDeadline = (deadlineIso?: string, serverTimeIso?: string, remaining?: number) => {
    if (typeof remaining === 'number') {
      setRemainingSeconds(remaining);
      deadlineRef.current = { endsAt: Date.now() + remaining * 1000 };
      return;
    }
    if (!deadlineIso || !serverTimeIso) {
      return;
    }
    const serverMs = Date.parse(serverTimeIso);
    const clientMs = Date.now();
    const drift = clientMs - serverMs;
    const endsAt = Date.parse(deadlineIso) + drift;
    deadlineRef.current = { endsAt };
    setRemainingSeconds(Math.max(0, Math.ceil((endsAt - clientMs) / 1000)));
  };

  if (!sessionId) {
    return (
      <div className="app-shell">
        <header>
          <h1>ToneDial Roulette</h1>
          <p>Add <code>?sid=&lt;session_id&gt;</code> to launch the Activity.</p>
        </header>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header>
        <h1>ToneDial Roulette</h1>
        <p>Configure rules, submit secret proposals, and watch the live slot reveal.</p>
        {discord?.ctx.guild?.id && (
          <p className="context-hint">
            Guild {discord.ctx.guild.id}
            {discord?.ctx.channel?.id ? ` · Channel ${discord.ctx.channel.id}` : ''}
          </p>
        )}
      </header>

      {fallbackError && (
        <div className="status-banner warning">
          Activity SDK fallback: {fallbackError}. Enter your Discord ID manually to continue.
        </div>
      )}

      {statusMessage && <div className="status-banner">{statusMessage}</div>}
      {sseLost && <div className="status-banner warning">Real-time stream paused. Refresh to reconnect.</div>}

      {!identityReady && (
        <section className="panel">
          <h2>Identify Yourself</h2>
          <form onSubmit={handleManualIdentity} className="manual-id-form">
            <label>
              Discord User ID
              <input
                value={manualUserId}
                onChange={(event) => setManualUserId(event.target.value)}
                placeholder="123456789012345678"
              />
            </label>
            <button type="submit" disabled={!manualUserId.trim()}>
              Continue
            </button>
          </form>
        </section>
      )}

      {snapshot ? (
        <>
          <section className="status-panel">
            <div>
              <p>Remaining</p>
              <strong>{formatSeconds(remainingSeconds)}</strong>
            </div>
            <div>
              <p>Max proposals</p>
              <strong>{snapshot.rules.maxProposals}</strong>
            </div>
            <div>
              <p>Owner</p>
              <strong>{isOwner ? 'You' : snapshot.ownerId ?? 'Unknown'}</strong>
            </div>
          </section>

          <section className="panel">
            <h2>Rules</h2>
            <ul className="rules-list">
              <li>
                Ownership: <span>{snapshot.rules.ownershipMode}</span>
              </li>
              <li>
                Pool mode: <span>{snapshot.rules.poolMode}</span>
              </li>
              <li>
                Vote window: <span>{snapshot.rules.timeSeconds}s</span>
              </li>
              {snapshot.rules.minPlayers && (
                <li>
                  Min players: <span>{snapshot.rules.minPlayers}</span>
                </li>
              )}
            </ul>
            {isOwner && remainingSeconds === 0 && !winner && (
              <button onClick={triggerClose}>Close session</button>
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Secret Proposals</h2>
              <span>
                {userVotes}/{snapshot.rules.maxProposals}
              </span>
            </div>
            <p className="panel-subtitle">Select games below. Votes stay hidden until the reveal.</p>
            <div className="candidates-grid">
              {filteredCandidates.map((candidate) => (
                <article key={candidate.appId} className="candidate-card">
                  <h3>{candidate.name}</h3>
                  <p>AppID: {candidate.appId}</p>
                  <p>Owners: {candidate.owners.length}</p>
                  <button
                    type="button"
                    disabled={disableVoting || submitted[candidate.appId]}
                    onClick={() => handleProposal(candidate)}
                  >
                    {submitted[candidate.appId] ? 'Submitted' : 'Propose'}
                  </button>
                </article>
              ))}
            </div>
          </section>

          <section className="slot-shell" aria-live="polite">
            <h2>Slot Reveal</h2>
            <div className="slot-track" ref={slotTrackRef} data-spinning={isSpinning}>
              {slotItems.map((item, index) => (
                <div key={`${item}-${index}`} className="slot-item">
                  {item}
                </div>
              ))}
            </div>
            {winner && <p>Winner AppID: {winner.appId}</p>}
          </section>
        </>
      ) : (
        <section className="panel">
          <p>Loading session data...</p>
        </section>
      )}
    </div>
  );
}

function formatSeconds(total: number) {
  const minutes = Math.floor(total / 60)
    .toString()
    .padStart(2, '0');
  const seconds = Math.floor(total % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function shuffle<T>(input: T[]) {
  const copy = [...input];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}
