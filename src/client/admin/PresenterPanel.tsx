import { useEffect, useRef, useState } from "react";
import type {
  AdminSessionDetail,
  PresenterAction,
} from "../../shared/contracts.js";
import { CommentGrid, ResultBars } from "../components/results.js";
import { Button, InlineNotice, StatusPill } from "../components/ui.js";
import { createSocket, type AppSocket } from "../socket.js";
import { useJoinQrCode } from "../use-join-qr-code.js";

export function PresenterPanel({
  session,
  onBack,
  onSnapshot,
  onAuthExpired,
}: {
  session: AdminSessionDetail;
  onBack: () => void;
  onSnapshot: (snapshot: AdminSessionDetail) => void;
  onAuthExpired: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const socketRef = useRef<AppSocket | null>(null);
  const qrCode = useJoinQrCode(session.joinName);

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;
    const subscribe = () => {
      socket.emit(
        "session:subscribe",
        { joinName: session.joinName, role: "admin" },
        (result) => {
          if (result.ok && result.data.role === "admin") {
            onSnapshot(result.data);
            setError(null);
          } else if (!result.ok) {
            if (result.error.code === "admin_required") onAuthExpired();
            else setError(result.error.message);
          }
        },
      );
    };
    socket.on("connect", subscribe);
    socket.on("session:snapshot", (snapshot) => {
      if (snapshot.role === "admin") onSnapshot(snapshot);
    });
    socket.on("disconnect", (reason) => {
      if (reason === "io server disconnect") onAuthExpired();
    });
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session.id, session.joinName, onAuthExpired, onSnapshot]);

  const command = (
    action: PresenterAction,
    options: { value?: boolean; confirm?: string } = {},
  ) => {
    if (options.confirm && !window.confirm(options.confirm)) return;
    const socket = socketRef.current;
    if (!socket) return;
    setBusy(true);
    setError(null);
    socket.emit(
      "presenter:command",
      {
        requestId: crypto.randomUUID(),
        action,
        expectedControlRevision: session.controlRevision,
        value: options.value,
      },
      (result) => {
        setBusy(false);
        if (result.ok) {
          onSnapshot(result.data);
        } else {
          if (result.error.code === "admin_required") {
            onAuthExpired();
            return;
          }
          setError(result.error.message);
          socket.emit("session:snapshot", (fresh) => {
            if (fresh.ok && fresh.data.role === "admin") onSnapshot(fresh.data);
          });
        }
      },
    );
  };

  const current =
    session.presentedPosition === null
      ? undefined
      : session.questions[session.presentedPosition];
  const isOpen = current?.status === "open";
  const hasNext = current ? current.position + 1 < session.questions.length : false;
  const hasFeedback = session.questions.some((question) => question.type === "feedback");

  return (
    <main className="admin-content presenter-page">
      <div className="admin-titlebar presenter-titlebar">
        <div>
          <button className="back-button" onClick={onBack}>
            ← Sessions
          </button>
          <div className="live-heading">
            <StatusPill>
              <span className="pulse-dot" aria-hidden="true" /> Live
            </StatusPill>
            <span className="eyebrow">Presenter Controls</span>
          </div>
          <h1>{session.title}</h1>
          <p className="presenter-titlebar__meta">
            /{session.joinName} · <span className="tabular">{session.joinedCount}</span>{" "}
            joined
          </p>
        </div>
        <div className="admin-titlebar__actions">
          <a
            className="button button--secondary"
            href={`/${session.joinName}`}
            target="_blank"
            rel="noreferrer"
          >
            Participant View ↗
          </a>
          <a
            className="button button--primary"
            href={`/${session.joinName}/display`}
            target="_blank"
            rel="noreferrer"
          >
            Open Display ↗
          </a>
        </div>
      </div>

      {error && <InlineNotice tone="error">{error}</InlineNotice>}

      <div className="presenter-layout">
        <section className="presenter-preview">
          {!current ? (
            <div className="presenter-lobby-preview">
              <div className="presenter-lobby-preview__layout">
                <div className="presenter-lobby-preview__copy">
                  <span className="eyebrow">Lobby</span>
                  <h2>Ready for the audience</h2>
                  <p>Scan the code or open the Join Name below.</p>
                  <strong>/{session.joinName}</strong>
                </div>
                <div className="presenter-qr-frame">
                  {qrCode ? (
                    <img
                      src={qrCode}
                      alt={`QR code for /${session.joinName}`}
                    />
                  ) : null}
                  <small>Scan to join</small>
                </div>
              </div>
            </div>
          ) : (
            <div className="presenter-question-preview">
              <div className="presenter-question-preview__header">
                <StatusPill>
                  {current.status === "open" ? "Open for voting" : "Voting closed"}
                </StatusPill>
                <span className="tabular">
                  {current.position + 1}/{session.questions.length}
                </span>
              </div>
              <h2>{current.prompt}</h2>
              {current.type === "single_choice" && current.result ? (
                <>
                  <ResultBars result={current.result} />
                  <p className="result-meta tabular">
                    {current.result.responseCount} responses ·{" "}
                    {current.result.participationPercentage.toFixed(1)}% participation
                  </p>
                </>
              ) : (
                <CommentGrid comments={current.comments} />
              )}
            </div>
          )}
        </section>

        <aside className="control-panel">
          <div className="control-panel__section">
            <span className="control-label">Question flow</span>
            {!current ? (
              <Button
                className="control-primary"
                disabled={busy}
                onClick={() => command("open_first")}
              >
                Show first Question
              </Button>
            ) : isOpen ? (
              <Button
                className="control-primary"
                disabled={busy}
                onClick={() =>
                  command("close", {
                    confirm: "Close this Question? Responses will become final.",
                  })
                }
              >
                Close voting
              </Button>
            ) : (
              <div className="navigation-controls">
                <Button
                  variant="secondary"
                  disabled={busy || current.position === 0}
                  onClick={() => command("previous")}
                >
                  ← Previous
                </Button>
                <Button
                  disabled={busy || !hasNext}
                  onClick={() => command("next")}
                >
                  Next →
                </Button>
              </div>
            )}
            <p className="control-help">
              {isOpen
                ? "Close voting before navigating or ending."
                : current
                  ? "Closed Questions stay final when revisited."
                  : "Everyone is waiting in the Lobby."}
            </p>
          </div>

          <div className="control-panel__section">
            <span className="control-label">Display</span>
            <button
              className="control-toggle"
              disabled={busy}
              onClick={() => command("toggle_theme")}
            >
              <span>
                <strong>Display theme</strong>
                <small>Synced to every public display</small>
              </span>
              <span className="toggle-value">
                {session.displayTheme === "light" ? "Light" : "Dark"}
              </span>
            </button>
            {hasFeedback && (
              <button
                className="control-toggle"
                disabled={busy}
                onClick={() =>
                  command("set_comment_wall", {
                    value: !session.commentWallVisible,
                  })
                }
              >
                <span>
                  <strong>Comment Wall</strong>
                  <small>Hide or reveal every Comment</small>
                </span>
                <span className="toggle-value">
                  {session.commentWallVisible ? "Visible" : "Hidden"}
                </span>
              </button>
            )}
          </div>

          <div className="control-panel__section control-panel__section--danger">
            <Button
              variant="danger"
              disabled={busy || isOpen}
              onClick={() =>
                command("end", {
                  confirm: "End this Voting Session? It cannot be restarted.",
                })
              }
            >
              End Session
            </Button>
          </div>
        </aside>
      </div>
    </main>
  );
}
