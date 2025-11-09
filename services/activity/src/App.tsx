import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type {
  RouletteGameCandidate,
  RouletteResult,
  RouletteSessionEvent,
  RouletteSessionSnapshot,
} from '@tonedial/shared';
import './styles.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080';

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('sessionId');
  const token = params.get('token');
  const initialUserId = params.get('userId') ?? '';

  const [snapshot, setSnapshot] = useState<RouletteSessionSnapshot | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [proposalUserId, setProposalUserId] = useState(initialUserId);
  const [proposalAppId, setProposalAppId] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [winner, setWinner] = useState<RouletteResult | null>(null);
  const [slotItems, setSlotItems] = useState<string[]>([]);
  const [isSpinning, setIsSpinning] = useState(false);
  const deadlineRef = useRef<number | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setStatusMessage('Missing sessionId in query string.');
      return;
    }
    (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/roulette/session/${sessionId}`);
        if (!response.ok) {
          throw new Error('Failed to load session snapshot');
        }
        const data = (await response.json()) as RouletteSessionSnapshot;
        setSnapshot(data);
        const deadline = new Date(data.deadline).getTime();
        deadlineRef.current = deadline;
        setRemainingSeconds(calcRemaining(deadline));
      } catch (error) {
        setStatusMessage((error as Error).message);
      }
    })();
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !token) {
      return;
    }
    const streamUrl = new URL(`/roulette/session/${sessionId}/events`, API_BASE_URL);
    streamUrl.searchParams.set('token', token);
    const source = new EventSource(streamUrl.toString());
    eventSourceRef.current = source;

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as RouletteSessionEvent;
        handleEvent(payload);
      } catch (error) {
        console.error('Failed to parse SSE event', error);
      }
    };

    source.onerror = () => {
      setStatusMessage('Lost real-time connection. Refresh to reconnect.');
      source.close();
    };

    return () => {
      source.close();
    };
  }, [sessionId, token]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!deadlineRef.current) {
        return;
      }
      setRemainingSeconds(calcRemaining(deadlineRef.current));
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!winner || !snapshot) {
      return;
    }
    const winnerCandidate = snapshot.pool.find((candidate) => candidate.appId === winner.appId);
    if (!winnerCandidate) {
      return;
    }
    const filler = shuffle(snapshot.pool.map((candidate) => candidate.name)).slice(0, 7);
    setSlotItems([...filler, winnerCandidate.name]);
    setIsSpinning(true);
    const timeout = window.setTimeout(() => setIsSpinning(false), 4000);
    return () => window.clearTimeout(timeout);
  }, [winner, snapshot]);

  const handleEvent = (event: RouletteSessionEvent) => {
    if (event.type === 'session.created') {
      setSnapshot(event.payload);
      const deadline = new Date(event.payload.deadline).getTime();
      deadlineRef.current = deadline;
      setRemainingSeconds(calcRemaining(deadline));
    } else if (event.type === 'session.updated') {
      setRemainingSeconds(event.payload.remainingSeconds);
    } else if (event.type === 'session.closed') {
      setWinner(event.payload);
      setStatusMessage(`Winner selected: app ${event.payload.appId}`);
    }
  };

  const handleProposal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionId) {
      setStatusMessage('Missing session.');
      return;
    }
    if (!proposalUserId.trim()) {
      setStatusMessage('Discord user ID is required.');
      return;
    }
    const appIdNumber = Number(proposalAppId);
    if (Number.isNaN(appIdNumber)) {
      setStatusMessage('AppID must be numeric.');
      return;
    }

    try {
      setStatusMessage('Submitting proposal...');
      const response = await fetch(`${API_BASE_URL}/roulette/vote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, userId: proposalUserId.trim(), appId: appIdNumber }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? 'Vote rejected');
      }
      setProposalAppId('');
      setStatusMessage('Proposal submitted.');
    } catch (error) {
      setStatusMessage((error as Error).message);
    }
  };

  const timerDisplay = useMemo(() => formatSeconds(remainingSeconds), [remainingSeconds]);

  if (!sessionId || !token) {
    return (
      <div className="app-shell">
        <header>
          <h1>ToneDial Roulette</h1>
          <p>Add <code>sessionId</code> and <code>token</code> query params to join the Activity.</p>
        </header>
      </div>
    );
  }

  const candidates = snapshot?.pool ?? [];

  return (
    <div className="app-shell">
      <header>
        <h1>ToneDial Roulette</h1>
        <p>Submit secret proposals, watch the timer, and enjoy the slot animation reveal.</p>
      </header>

      {statusMessage && <div className="status-banner">{statusMessage}</div>}

      <section className="status-panel">
        <div>
          <p>Remaining</p>
          <strong>{timerDisplay}</strong>
        </div>
        <div>
          <p>Candidates</p>
          <strong>{candidates.length}</strong>
        </div>
        <div>
          <p>Winner</p>
          <strong>{winner?.appId ?? '—'}</strong>
        </div>
      </section>

      <section className="proposal-panel">
        <h2>Submit Proposal</h2>
        <form onSubmit={handleProposal} className="proposal-form">
          <label>
            Discord User ID
            <input
              value={proposalUserId}
              onChange={(event) => setProposalUserId(event.target.value)}
              placeholder="123456789012345678"
            />
          </label>
          <label>
            Steam AppID
            <input
              value={proposalAppId}
              onChange={(event) => setProposalAppId(event.target.value)}
              placeholder="570"
            />
          </label>
          <button type="submit" disabled={!proposalUserId || !proposalAppId}>
            Submit Secret Vote
          </button>
        </form>
      </section>

      <section className="candidates-grid">
        {candidates.map((candidate) => (
          <article key={candidate.appId} className="candidate-card">
            <h3>{candidate.name}</h3>
            <p>AppID: {candidate.appId}</p>
            <p>Owners: {candidate.owners.length}</p>
          </article>
        ))}
      </section>

      <section className="slot-shell">
        <h2>Slot Reveal</h2>
        <div className={`slot-track ${isSpinning ? 'spinning' : ''}`}>
          {slotItems.map((item, index) => (
            <div key={`${item}-${index}`} className="slot-item">
              {item}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function calcRemaining(deadline: number) {
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
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
    const temp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = temp;
  }
  return copy;
}
