import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import type {
  CommandResult,
  GuestCredentials,
  ParticipantSnapshot,
} from "../../shared/contracts.js";
import { apiRequest } from "../api.js";
import { SessionResults } from "../components/results.js";
import {
  Brand,
  Button,
  ErrorState,
  InlineNotice,
  Loading,
  PageShell,
  StatusPill,
} from "../components/ui.js";
import {
  readGuestCredentials,
  saveGuestCredentials,
} from "../guest-storage.js";
import { translate, translateResponseError } from "../i18n.js";
import { createSocket, type AppSocket } from "../socket.js";

interface JoinResponse {
  credentials: GuestCredentials | null;
  snapshot: ParticipantSnapshot;
  issued: boolean;
}

export function ParticipantPage() {
  const { joinName = "" } = useParams();
  const [snapshot, setSnapshot] = useState<ParticipantSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [comment, setComment] = useState("");
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null);
  const socketRef = useRef<AppSocket | null>(null);
  const credentialsRef = useRef<GuestCredentials | null>(null);
  const joinedRef = useRef(false);

  useEffect(() => {
    let active = true;
    joinedRef.current = false;
    credentialsRef.current = null;
    const socket = createSocket();
    socketRef.current = socket;

    const subscribe = (credentials: GuestCredentials | null) => {
      socket.emit(
        "session:subscribe",
        { joinName, role: "participant", credentials: credentials ?? undefined },
        (result) => {
          if (!active) return;
          if (result.ok && result.data.role === "participant") {
            setSnapshot(result.data);
            setError(null);
          } else if (!result.ok) {
            setError(result.error.message);
          }
        },
      );
    };

    const join = async () => {
      try {
        const response = await apiRequest<JoinResponse>(
          `/api/public/sessions/${encodeURIComponent(joinName)}/join`,
          {
            method: "POST",
            body: JSON.stringify({
              credentials: readGuestCredentials(joinName),
            }),
          },
        );
        if (!active) return;
        credentialsRef.current = response.credentials;
        joinedRef.current = true;
        if (response.credentials) {
          saveGuestCredentials(joinName, response.credentials);
        }
        setSnapshot(response.snapshot);
        setError(null);
        subscribe(response.credentials);
      } catch (joinError) {
        if (!active) return;
        setError(
          joinError instanceof Error
            ? joinError.message
            : "Could not join this session.",
        );
      }
    };

    socket.on("connect", () => {
      if (joinedRef.current) {
        subscribe(credentialsRef.current);
      }
    });
    socket.on("session:snapshot", (nextSnapshot) => {
      if (nextSnapshot.role === "participant" && active) {
        setSnapshot(nextSnapshot);
        setPendingOptionId(null);
      }
    });
    void join();

    return () => {
      active = false;
      socket.disconnect();
      socketRef.current = null;
    };
  }, [joinName]);

  useEffect(() => {
    setComment(snapshot?.ownResponse?.content ?? "");
    setSubmissionError(null);
  }, [snapshot?.currentQuestion?.id, snapshot?.ownResponse?.updatedAt]);

  const submit = (
    payload: { questionId: string; optionId?: string; content?: string },
  ) => {
    const socket = socketRef.current;
    if (!socket) return;
    setSaving(true);
    setSubmissionError(null);
    socket.emit(
      "response:submit",
      { requestId: crypto.randomUUID(), ...payload },
      (result: CommandResult<ParticipantSnapshot>) => {
        setSaving(false);
        if (result.ok) {
          setSnapshot(result.data);
          setPendingOptionId(null);
        } else {
          setSubmissionError(
            translateResponseError(
              snapshot?.language ?? "en",
              result.error.code,
              result.error.message,
            ),
          );
          setPendingOptionId(null);
          socket.emit("session:snapshot", (fresh) => {
            if (fresh.ok && fresh.data.role === "participant") {
              setSnapshot(fresh.data);
            }
          });
        }
      },
    );
  };

  if (error) {
    return (
      <PageShell>
        <header className="site-header">
          <Brand />
        </header>
        <ErrorState
          message={error}
          action={
            <Link className="button button--secondary" to="/">
              Back to live sessions
            </Link>
          }
        />
      </PageShell>
    );
  }
  if (!snapshot) {
    return <Loading label="Connecting to the session…" />;
  }
  if (snapshot.status === "ended") {
    return (
      <PageShell className="participant-page participant-page--results">
        <SessionResults
          title={snapshot.title}
          language={snapshot.language}
          results={snapshot.results}
        />
      </PageShell>
    );
  }

  const language = snapshot.language;
  const question = snapshot.currentQuestion;
  const selectedOptionId = pendingOptionId ?? snapshot.ownResponse?.optionId;

  return (
    <PageShell className="participant-page">
      <header className="participant-header">
        <span className="participant-header__session">{snapshot.title}</span>
      </header>
      {!question ? (
        <main className="participant-stage participant-lobby">
          <div className="lobby-orbit" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <span className="eyebrow stagger-item">
            {translate(language, "lobbyEyebrow")}
          </span>
          <h1 className="stagger-item">{translate(language, "lobbyTitle")}</h1>
          <p className="stagger-item">{translate(language, "lobbyBody")}</p>
        </main>
      ) : (
        <main className="participant-stage question-stage" key={question.id}>
          <div className="question-stage__status stagger-item">
            <StatusPill>
              {question.status === "open"
                ? translate(language, "open")
                : translate(language, "closed")}
            </StatusPill>
            <span className="question-count tabular">
              {question.position + 1}
            </span>
          </div>
          <h1 className="stagger-item">{question.prompt}</h1>
          {question.type === "single_choice" ? (
            <div className="vote-panel stagger-item">
              <p className="vote-panel__hint">
                {translate(language, "choose")}
              </p>
              <div className="option-list">
                {question.options.map((option) => {
                  const selected = selectedOptionId === option.id;
                  return (
                    <Button
                      className={`vote-option${selected ? " vote-option--selected" : ""}`}
                      variant="secondary"
                      disabled={question.status !== "open" || saving}
                      aria-pressed={selected}
                      onClick={() => {
                        setPendingOptionId(option.id);
                        submit({ questionId: question.id, optionId: option.id });
                      }}
                      key={option.id}
                    >
                      <span>{option.label}</span>
                      <span className="option-check" aria-hidden="true">
                        ✓
                      </span>
                    </Button>
                  );
                })}
              </div>
              {selectedOptionId && (
                <p className="saved-label" aria-live="polite">
                  {saving
                    ? translate(language, "saving")
                    : translate(language, "chosen")}
                </p>
              )}
              {question.status === "open" && (
                <p className="microcopy">{translate(language, "update")}</p>
              )}
            </div>
          ) : (
            <form
              className="feedback-form stagger-item"
              onSubmit={(event) => {
                event.preventDefault();
                submit({ questionId: question.id, content: comment });
              }}
            >
              <label htmlFor="participant-comment">
                {translate(language, "feedback")}
              </label>
              <textarea
                id="participant-comment"
                maxLength={160}
                value={comment}
                disabled={question.status !== "open" || saving}
                placeholder={translate(language, "commentPlaceholder")}
                onChange={(event) => setComment(event.target.value)}
              />
              <div className="feedback-form__meta">
                <span className="tabular">{comment.length}/160</span>
                <span>{translate(language, "commentLimit")}</span>
              </div>
              <Button
                type="submit"
                disabled={
                  question.status !== "open" || saving || comment.trim().length === 0
                }
              >
                {saving
                  ? translate(language, "saving")
                  : snapshot.ownResponse?.content
                    ? translate(language, "updateComment")
                    : translate(language, "submitComment")}
              </Button>
            </form>
          )}
          {submissionError && (
            <InlineNotice tone="error">{submissionError}</InlineNotice>
          )}
        </main>
      )}
    </PageShell>
  );
}
