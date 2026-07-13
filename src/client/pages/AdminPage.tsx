import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type {
  AdminSessionDetail,
  AdminSessionSummary,
  SessionStatus,
} from "../../shared/contracts.js";
import { EndedPanel } from "../admin/EndedPanel.js";
import { PresenterPanel } from "../admin/PresenterPanel.js";
import { SessionEditor } from "../admin/SessionEditor.js";
import { ApiError, apiRequest } from "../api.js";
import {
  Brand,
  Button,
  ErrorState,
  InlineNotice,
  Loading,
  PageShell,
  StatusPill,
} from "../components/ui.js";

function Login({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <PageShell className="login-page">
      <header className="site-header">
        <Brand />
        <Link className="text-link" to="/">
          Live sessions
        </Link>
      </header>
      <main className="login-card stagger-item">
        <h1>Admin panel</h1>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            void apiRequest("/api/admin/login", {
              method: "POST",
              body: JSON.stringify({ password }),
            })
              .then(onAuthenticated)
              .catch((loginError: unknown) => {
                setError(
                  loginError instanceof Error
                    ? loginError.message
                    : "Could not sign in.",
                );
              })
              .finally(() => setBusy(false));
          }}
        >
          <label>
            <span>Password</span>
            <input
              autoComplete="current-password"
              type="password"
              value={password}
              autoFocus
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && <InlineNotice tone="error">{error}</InlineNotice>}
          <Button type="submit" disabled={busy || password.length === 0}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </main>
    </PageShell>
  );
}

function SessionList({
  sessions,
  onCreate,
  onSelect,
}: {
  sessions: AdminSessionSummary[];
  onCreate: () => void;
  onSelect: (session: AdminSessionSummary) => void;
}) {
  const groups: Array<{ status: SessionStatus; title: string }> = [
    { status: "live", title: "Live Sessions" },
    { status: "draft", title: "Draft Sessions" },
    { status: "ended", title: "Ended Sessions" },
  ];

  return (
    <main className="admin-content dashboard-page">
      <div className="admin-titlebar">
        <div>
          <span className="eyebrow">Admin Panel</span>
          <h1>Voting Sessions</h1>
          <p>Prepare a Question set, then run the room from Presenter Controls.</p>
        </div>
        <Button onClick={onCreate}>+ New Session</Button>
      </div>
      {sessions.length === 0 ? (
        <section className="empty-card dashboard-empty">
          <h2>Create your first Voting Session</h2>
          <p>Add Questions now; start it when the room is ready.</p>
          <Button onClick={onCreate}>Create Session</Button>
        </section>
      ) : (
        <div className="admin-session-groups">
          {groups.map((group) => {
            const groupSessions = sessions.filter(
              (session) => session.status === group.status,
            );
            if (groupSessions.length === 0) return null;
            return (
              <section className="admin-session-group" key={group.status}>
                <div className="admin-session-group__heading">
                  <h2>{group.title}</h2>
                  <span className="tabular">{groupSessions.length}</span>
                </div>
                <div className="admin-session-list">
                  {groupSessions.map((session) => (
                    <button
                      className="admin-session-row"
                      onClick={() => onSelect(session)}
                      key={session.id}
                    >
                      <span className="admin-session-row__status">
                        <StatusPill>
                          {session.status === "live" && (
                            <span className="pulse-dot" aria-hidden="true" />
                          )}
                          {session.status[0]!.toUpperCase() + session.status.slice(1)}
                        </StatusPill>
                      </span>
                      <span className="admin-session-row__name">
                        <strong>{session.title}</strong>
                        <small>/{session.joinName}</small>
                      </span>
                      <span className="admin-session-row__counts tabular">
                        {session.questionCount} Questions
                        <small>{session.joinedCount} joined</small>
                      </span>
                      <span className="arrow" aria-hidden="true">
                        →
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}

export function AdminPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [sessions, setSessions] = useState<AdminSessionSummary[] | null>(null);
  const [selected, setSelected] = useState<AdminSessionDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expireAuthentication = useCallback(() => {
    setAuthenticated(false);
    setSelected(null);
    setSessions(null);
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const response = await apiRequest<{ sessions: AdminSessionSummary[] }>(
        "/api/admin/sessions",
      );
      setSessions(response.sessions);
      setError(null);
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        setAuthenticated(false);
        return;
      }
      setError(
        loadError instanceof Error ? loadError.message : "Could not load sessions.",
      );
    }
  }, []);

  useEffect(() => {
    void apiRequest("/api/admin/me")
      .then(() => {
        setAuthenticated(true);
        return loadSessions();
      })
      .catch(() => setAuthenticated(false));
  }, [loadSessions]);

  const select = async (session: AdminSessionSummary) => {
    setError(null);
    try {
      const detail = await apiRequest<AdminSessionDetail>(
        `/api/admin/sessions/${session.id}`,
      );
      setSelected(detail);
      setCreating(false);
    } catch (selectError) {
      setError(
        selectError instanceof Error
          ? selectError.message
          : "Could not open this session.",
      );
    }
  };

  const returnToList = () => {
    setSelected(null);
    setCreating(false);
    void loadSessions();
  };

  const handleSnapshot = useCallback(
    (snapshot: AdminSessionDetail) => {
      setSelected(snapshot);
      if (snapshot.status === "ended") void loadSessions();
    },
    [loadSessions],
  );

  if (authenticated === null) return <Loading label="Opening the Admin Panel…" />;
  if (!authenticated) {
    return (
      <Login
        onAuthenticated={() => {
          setAuthenticated(true);
          void loadSessions();
        }}
      />
    );
  }

  return (
    <PageShell className="admin-page">
      <header className="admin-header">
        <Brand />
        <nav>
          <Link className="text-link" to="/">
            Public homepage ↗
          </Link>
          <button
            className="text-link"
            onClick={() => {
              void apiRequest("/api/admin/logout", { method: "POST" }).finally(() => {
                setAuthenticated(false);
                setSelected(null);
                setSessions(null);
              });
            }}
          >
            Log out
          </button>
        </nav>
      </header>

      {error && !selected && !creating && (
        <ErrorState
          message={error}
          action={
            <Button variant="secondary" onClick={loadSessions}>
              Try again
            </Button>
          }
        />
      )}
      {creating ? (
        <SessionEditor
          onBack={returnToList}
          onSaved={(session) => {
            setSelected(session);
            setCreating(false);
            void loadSessions();
          }}
          onDeleted={returnToList}
        />
      ) : selected?.status === "draft" ? (
        <SessionEditor
          session={selected}
          onBack={returnToList}
          onSaved={(session) => {
            setSelected(session);
            void loadSessions();
          }}
          onDeleted={returnToList}
        />
      ) : selected?.status === "live" ? (
        <PresenterPanel
          session={selected}
          onBack={returnToList}
          onSnapshot={handleSnapshot}
          onAuthExpired={expireAuthentication}
        />
      ) : selected?.status === "ended" ? (
        <EndedPanel
          session={selected}
          onBack={returnToList}
          onDuplicated={(session) => {
            setSelected(session);
            void loadSessions();
          }}
          onDeleted={returnToList}
        />
      ) : sessions === null ? (
        <Loading label="Loading Voting Sessions…" />
      ) : (
        <SessionList
          sessions={sessions}
          onCreate={() => {
            setCreating(true);
            setSelected(null);
          }}
          onSelect={(session) => void select(session)}
        />
      )}
    </PageShell>
  );
}
