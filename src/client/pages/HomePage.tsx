import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type { LiveSessionSummary } from "../../shared/contracts.js";
import { apiRequest } from "../api.js";
import { Brand, ErrorState, Loading, PageShell, StatusPill } from "../components/ui.js";
import { createSocket } from "../socket.js";

export function HomePage() {
  const [sessions, setSessions] = useState<LiveSessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const response = await apiRequest<{ sessions: LiveSessionSummary[] }>(
        "/api/public/sessions",
      );
      setSessions(response.sessions);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Could not load sessions.",
      );
    }
  }, []);

  useEffect(() => {
    void loadSessions();
    const socket = createSocket();
    socket.on("connect", loadSessions);
    socket.on("sessions:changed", loadSessions);
    return () => {
      socket.disconnect();
    };
  }, [loadSessions]);

  return (
    <PageShell className="home-page">
      <header className="site-header">
        <Brand />
        <Link className="text-link" to="/admin">
          Presenter
        </Link>
      </header>
      <main className="home-main">
        <div className="home-intro stagger-item">
          <span className="eyebrow">Live now</span>
          <h1>Choose a Voting Session</h1>
          <p>Tap a session to join. No account or password needed.</p>
        </div>

        {error ? (
          <ErrorState
            message={error}
            action={
              <button className="button button--secondary" onClick={loadSessions}>
                Try again
              </button>
            }
          />
        ) : sessions === null ? (
          <Loading label="Looking for live sessions…" />
        ) : sessions.length === 0 ? (
          <section className="empty-card stagger-item">
            <span className="pulse-dot" aria-hidden="true" />
            <h2>No sessions are live yet</h2>
            <p>When the presenter starts one, it will appear here.</p>
          </section>
        ) : (
          <div className="session-grid">
            {sessions.map((session, index) => (
              <Link
                className="session-card stagger-item"
                style={{ animationDelay: `${Math.min(index, 5) * 80}ms` }}
                to={`/${session.joinName}`}
                key={session.id}
              >
                <div className="session-card__top">
                  <StatusPill>
                    <span className="pulse-dot" aria-hidden="true" /> Live
                  </StatusPill>
                  <span className="arrow" aria-hidden="true">
                    →
                  </span>
                </div>
                <h2>{session.title}</h2>
                <div className="session-card__meta">
                  <span>/{session.joinName}</span>
                  <span className="tabular">{session.joinedCount} joined</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </PageShell>
  );
}
