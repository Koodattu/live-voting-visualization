import { useState } from "react";
import type { AdminSessionDetail } from "../../shared/contracts.js";
import { apiRequest } from "../api.js";
import { CommentGrid, ResultBars } from "../components/results.js";
import { Button, InlineNotice, StatusPill } from "../components/ui.js";

export function EndedPanel({
  session,
  onBack,
  onDuplicated,
  onDeleted,
}: {
  session: AdminSessionDetail;
  onBack: () => void;
  onDuplicated: (session: AdminSessionDetail) => void;
  onDeleted: () => void;
}) {
  const [joinName, setJoinName] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const duplicate = async () => {
    setBusy(true);
    setError(null);
    try {
      const copy = await apiRequest<AdminSessionDetail>(
        `/api/admin/sessions/${session.id}/duplicate`,
        { method: "POST", body: JSON.stringify({ joinName }) },
      );
      onDuplicated(copy);
    } catch (duplicateError) {
      setError(
        duplicateError instanceof Error
          ? duplicateError.message
          : "Could not duplicate this session.",
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Permanently delete this Voting Session?")) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest<void>(`/api/admin/sessions/${session.id}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmation }),
      });
      onDeleted();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete this session.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="admin-content ended-page">
      <div className="admin-titlebar">
        <div>
          <button className="back-button" onClick={onBack}>
            ← Sessions
          </button>
          <div className="live-heading">
            <StatusPill>Ended</StatusPill>
            <span className="eyebrow">Session history</span>
          </div>
          <h1>{session.title}</h1>
          <p>/{session.joinName}</p>
        </div>
        <div className="admin-titlebar__actions">
          <a
            className="button button--secondary"
            href={`/${session.joinName}`}
            target="_blank"
            rel="noreferrer"
          >
            Public Results ↗
          </a>
          <a
            className="button button--primary"
            href={`/api/admin/sessions/${session.id}/export.csv`}
          >
            Export CSV
          </a>
        </div>
      </div>

      {error && <InlineNotice tone="error">{error}</InlineNotice>}

      <div className="ended-layout">
        <section className="admin-results">
          <div className="section-heading">
            <span className="step-number tabular">{session.questions.length}</span>
            <div>
              <h2>Questions and responses</h2>
              <p>
                Unshown Questions remain here but are omitted from public Session Results.
              </p>
            </div>
          </div>
          <div className="admin-result-list">
            {session.questions.map((question) => (
              <article
                className={`admin-result-card${question.status === "unshown" ? " admin-result-card--unshown" : ""}`}
                key={question.id}
              >
                <div className="admin-result-card__header">
                  <span className="question-number tabular">{question.position + 1}</span>
                  <StatusPill>
                    {question.status === "unshown" ? "Unshown" : "Presented"}
                  </StatusPill>
                </div>
                <h3>{question.prompt}</h3>
                {question.type === "single_choice" && question.result ? (
                  <>
                    <ResultBars result={question.result} compact />
                    <p className="result-meta tabular">
                      {question.result.responseCount} responses
                    </p>
                  </>
                ) : (
                  <CommentGrid comments={question.comments} />
                )}
              </article>
            ))}
          </div>
        </section>

        <aside className="ended-actions">
          <section>
            <h2>Duplicate Question set</h2>
            <p>Create a response-free Draft with a new Join Name.</p>
            <label>
              <span>New Join Name</span>
              <div className="slug-input">
                <span>/</span>
                <input
                  maxLength={24}
                  value={joinName}
                  placeholder="next-event"
                  onChange={(event) => setJoinName(event.target.value.toLowerCase())}
                />
              </div>
            </label>
            <Button
              variant="secondary"
              disabled={busy || joinName.length < 3}
              onClick={duplicate}
            >
              Duplicate to Draft
            </Button>
          </section>
          <section className="danger-zone">
            <h2>Delete Session</h2>
            <p>
              This removes Questions, identities, Votes, and Comments. Type{" "}
              <strong>{session.joinName}</strong> to confirm.
            </p>
            <input
              value={confirmation}
              aria-label="Join Name confirmation"
              onChange={(event) => setConfirmation(event.target.value)}
            />
            <Button
              variant="danger"
              disabled={busy || confirmation.toLowerCase() !== session.joinName}
              onClick={remove}
            >
              Delete permanently
            </Button>
          </section>
        </aside>
      </div>
    </main>
  );
}
