import { useState } from "react";
import type {
  AdminSessionDetail,
} from "../../shared/contracts.js";
import { CommentGrid, ResultBars } from "../components/results.js";
import { RecapSlide } from "../components/RecapSlide.js";
import { Button, ConfirmationDialog, InlineNotice, StatusPill } from "../components/ui.js";
import { translate } from "../i18n.js";
import { usePresenterSession } from "./use-presenter-session.js";
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
  const { error, busy, command } = usePresenterSession(session, onSnapshot, onAuthExpired);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const qrCode = useJoinQrCode(session.joinName);

  const current =
    session.presentedPosition === null
      ? undefined
      : session.questions[session.presentedPosition];
  const isLastQuestion = current?.position === session.questions.length - 1;
  const hasNext = !session.recapVisible && Boolean(current && (!isLastQuestion || session.aiRecapEnabled));
  const hasFeedback = session.questions.some((question) => question.type === "feedback");

  return (
    <main className="admin-content presenter-page">
      <ConfirmationDialog
        open={confirmEnd}
        title={translate("en", "endSessionTitle")}
        description={translate("en", "endSessionBody")}
        confirmLabel={translate("en", "endSession")}
        danger
        onCancel={() => setConfirmEnd(false)}
        onConfirm={() => {
          setConfirmEnd(false);
          command("end");
        }}
      />
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
          {session.recapVisible ? (
            <RecapSlide recap={session.recap} language={session.language} />
          ) : !current ? (
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
            ) : (
              <div className="navigation-controls">
                <Button
                  variant="secondary"
                  disabled={busy || (current.position === 0 && !session.recapVisible)}
                  onClick={() => command("previous")}
                >
                  ← Previous
                </Button>
                <Button
                  disabled={busy || !hasNext}
                  onClick={() => command("next")}
                >
                  {isLastQuestion && session.aiRecapEnabled ? translate("en", "showRecap") : "Next →"}
                </Button>
              </div>
            )}
            <p className="control-help">
              {translate("en", session.recapVisible ? "recapFlowHelp" : session.lockQuestions ? "lockQuestionsHelp" : "dontLockQuestionsHelp")}
            </p>
            {session.aiRecapEnabled && !session.aiRecapAvailable && <p className="control-help">{translate("en", "recapSetup")}</p>}
            {session.recapVisible && session.recap.status === "failed" && (
              <Button variant="secondary" disabled={busy || !session.aiRecapAvailable} onClick={() => command("retry_recap")}>
                {translate("en", "recapRetry")}
              </Button>
            )}
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
              disabled={busy}
              onClick={() => setConfirmEnd(true)}
            >
              End Session
            </Button>
          </div>
        </aside>
      </div>
    </main>
  );
}
