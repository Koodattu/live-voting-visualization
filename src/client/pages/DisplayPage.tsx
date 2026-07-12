import { useEffect, useState } from "react";
import { useParams } from "react-router";
import type { DisplaySnapshot } from "../../shared/contracts.js";
import { apiRequest } from "../api.js";
import { CommentWall, QuestionResult, ResultBars } from "../components/results.js";
import { ErrorState, Loading, StatusPill } from "../components/ui.js";
import { translate } from "../i18n.js";
import { createSocket } from "../socket.js";
import { useJoinQrCode } from "../use-join-qr-code.js";

export function DisplayPage() {
  const { joinName = "" } = useParams();
  const [snapshot, setSnapshot] = useState<DisplaySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qrCode = useJoinQrCode(joinName);

  useEffect(() => {
    let active = true;
    const socket = createSocket();
    const subscribe = () => {
      socket.emit(
        "session:subscribe",
        { joinName, role: "display" },
        (result) => {
          if (!active) return;
          if (result.ok && result.data.role === "display") {
            setSnapshot(result.data);
            setError(null);
          } else if (!result.ok) {
            setError(result.error.message);
          }
        },
      );
    };
    socket.on("connect", subscribe);
    socket.on("session:snapshot", (nextSnapshot) => {
      if (active && nextSnapshot.role === "display") setSnapshot(nextSnapshot);
    });
    void apiRequest<DisplaySnapshot>(
      `/api/public/sessions/${encodeURIComponent(joinName)}/display`,
    )
      .then((initial) => {
        if (active) setSnapshot(initial);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load this display.",
          );
        }
      });
    return () => {
      active = false;
      socket.disconnect();
    };
  }, [joinName]);

  if (error) return <ErrorState message={error} />;
  if (!snapshot) return <Loading label="Preparing the display…" />;

  const language = snapshot.language;
  const question = snapshot.currentQuestion;
  const directUrl = `${window.location.host}/${snapshot.joinName}`;

  return (
    <main
      className="display-page"
      data-theme={snapshot.displayTheme}
      key={`${snapshot.sessionId}:${snapshot.displayTheme}`}
    >
      {!question ? (
        snapshot.status === "ended" ? (
          <section className="display-complete">
            <span className="display-complete__mark" aria-hidden="true">
              ✓
            </span>
            <h1>{translate(language, "completed")}</h1>
            <p>{translate(language, "completedBody")}</p>
          </section>
        ) : (
          <section className="display-lobby">
            <div className="display-lobby__copy stagger-item">
              <span className="eyebrow">{translate(language, "scan")}</span>
              <h1>{snapshot.title}</h1>
              <div className="join-address">
                <span>{translate(language, "joinAt")}</span>
                <strong>{directUrl}</strong>
              </div>
              <div className="joined-count tabular">
                <strong>{snapshot.joinedCount}</strong>
                <span>{translate(language, "joined")}</span>
              </div>
            </div>
            <div className="qr-frame stagger-item">
              {qrCode ? <img src={qrCode} alt={`QR code for ${directUrl}`} /> : null}
              <strong>/{snapshot.joinName}</strong>
            </div>
          </section>
        )
      ) : (
        <section className="display-stage" key={question.id}>
          {snapshot.previousQuestion && (
            <aside className="previous-strip">
              <span className="previous-strip__label">
                {translate(language, "previous")}
              </span>
              <QuestionResult
                question={snapshot.previousQuestion}
                language={language}
                compact
              />
            </aside>
          )}
          <div className="display-question">
            <header className="display-question__header stagger-item">
              <StatusPill>
                {question.status === "open"
                  ? translate(language, "open")
                  : translate(language, "closed")}
              </StatusPill>
              <span className="display-question__number tabular">
                {question.position + 1}
              </span>
              <h1>{question.prompt}</h1>
            </header>
            {question.type === "single_choice" && question.result ? (
              <div className="display-results stagger-item" aria-live="polite">
                <ResultBars result={question.result} />
                <div className="display-results__totals tabular">
                  <span>
                    <strong>{question.result.responseCount}</strong>{" "}
                    {translate(language, "responses")}
                  </span>
                  <span>
                    <strong>
                      {question.result.participationPercentage.toFixed(1)}%
                    </strong>{" "}
                    {translate(language, "participation")}
                  </span>
                </div>
              </div>
            ) : snapshot.commentWallVisible ? (
              <div className="display-comments stagger-item">
                <CommentWall comments={question.comments} language={language} />
              </div>
            ) : (
              <div className="wall-hidden stagger-item">
                <span aria-hidden="true">◌</span>
                <p>{translate(language, "wallHidden")}</p>
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
