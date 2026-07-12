import { useEffect, useState } from "react";
import type {
  AdminSessionDetail,
  DraftQuestionInput,
  DraftSessionInput,
} from "../../shared/contracts.js";
import { apiRequest } from "../api.js";
import { Button, InlineNotice } from "../components/ui.js";

function emptyDraft(session?: AdminSessionDetail): DraftSessionInput {
  if (!session) {
    return { title: "", joinName: "", language: "en", questions: [] };
  }
  return {
    title: session.title,
    joinName: session.joinName,
    language: session.language,
    questions: session.questions.map((question) => ({
      type: question.type,
      prompt: question.prompt,
      options: question.options.map((option) => ({ label: option.label })),
    })),
  };
}

export function SessionEditor({
  session,
  onBack,
  onSaved,
  onDeleted,
}: {
  session?: AdminSessionDetail;
  onBack: () => void;
  onSaved: (session: AdminSessionDetail) => void;
  onDeleted: () => void;
}) {
  const [draft, setDraft] = useState<DraftSessionInput>(() => emptyDraft(session));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(emptyDraft(session));
    setError(null);
    setSaved(false);
  }, [session?.id]);

  const updateQuestion = (
    index: number,
    update: (question: DraftQuestionInput) => DraftQuestionInput,
  ) => {
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((question, questionIndex) =>
        questionIndex === index ? update(question) : question,
      ),
    }));
    setSaved(false);
  };

  const addQuestion = (question: DraftQuestionInput) => {
    setDraft((current) => {
      const questions = [...current.questions];
      const feedbackIndex = questions.findIndex((item) => item.type === "feedback");
      if (question.type === "feedback") {
        if (feedbackIndex === -1) questions.push(question);
      } else if (feedbackIndex === -1) {
        questions.push(question);
      } else {
        questions.splice(feedbackIndex, 0, question);
      }
      return { ...current, questions };
    });
    setSaved(false);
  };

  const presetLabels =
    draft.language === "fi"
      ? {
          yesNo: ["Kyllä", "Ei"],
          agreement: [
            "Täysin eri mieltä",
            "Eri mieltä",
            "Neutraali",
            "Samaa mieltä",
            "Täysin samaa mieltä",
          ],
          best: ["Vaihtoehto 1", "Vaihtoehto 2", "Vaihtoehto 3", "Vaihtoehto 4", "Vaihtoehto 5"],
        }
      : {
          yesNo: ["Yes", "No"],
          agreement: [
            "Strongly disagree",
            "Disagree",
            "Neutral",
            "Agree",
            "Strongly agree",
          ],
          best: ["Option 1", "Option 2", "Option 3", "Option 4", "Option 5"],
        };

  const save = async (): Promise<AdminSessionDetail> => {
    setBusy(true);
    setError(null);
    try {
      const savedSession = session
        ? await apiRequest<AdminSessionDetail>(
            `/api/admin/sessions/${session.id}`,
            {
              method: "PUT",
              body: JSON.stringify({
                session: draft,
                expectedControlRevision: session.controlRevision,
              }),
            },
          )
        : await apiRequest<AdminSessionDetail>("/api/admin/sessions", {
            method: "POST",
            body: JSON.stringify(draft),
          });
      setSaved(true);
      onSaved(savedSession);
      return savedSession;
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "Could not save this Draft.";
      setError(message);
      throw saveError;
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!window.confirm("Start this Voting Session? Questions cannot be changed afterward.")) {
      return;
    }
    try {
      const savedSession = await save();
      setBusy(true);
      const liveSession = await apiRequest<AdminSessionDetail>(
        `/api/admin/sessions/${savedSession.id}/start`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedControlRevision: savedSession.controlRevision,
            requestId: crypto.randomUUID(),
          }),
        },
      );
      onSaved(liveSession);
    } catch (startError) {
      setError(
        startError instanceof Error
          ? startError.message
          : "Could not start this session.",
      );
    } finally {
      setBusy(false);
    }
  };

  const removeDraft = async () => {
    if (!session || !window.confirm("Delete this Draft Session?")) return;
    setBusy(true);
    try {
      await apiRequest<void>(`/api/admin/sessions/${session.id}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmation: true }),
      });
      onDeleted();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Could not delete this Draft.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="admin-content editor-page">
      <div className="admin-titlebar">
        <div>
          <button className="back-button" onClick={onBack}>
            ← Sessions
          </button>
          <span className="eyebrow">Draft Session</span>
          <h1>{session ? session.title : "New Voting Session"}</h1>
        </div>
        <div className="admin-titlebar__actions">
          {session && (
            <Button variant="danger" disabled={busy} onClick={removeDraft}>
              Delete Draft
            </Button>
          )}
          <Button variant="secondary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save Draft"}
          </Button>
          <Button disabled={busy || draft.questions.length === 0} onClick={start}>
            Start Session
          </Button>
        </div>
      </div>

      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {saved && !error && <InlineNotice tone="success">Draft saved.</InlineNotice>}

      <section className="editor-section editor-section--details">
        <div className="section-heading">
          <span className="step-number tabular">01</span>
          <div>
            <h2>Session details</h2>
            <p>These appear on the public joining screen.</p>
          </div>
        </div>
        <div className="field-grid">
          <label>
            <span>Title</span>
            <input
              maxLength={100}
              value={draft.title}
              placeholder="Quarterly town hall"
              onChange={(event) => {
                setDraft((current) => ({ ...current, title: event.target.value }));
                setSaved(false);
              }}
            />
          </label>
          <label>
            <span>Join Name</span>
            <div className="slug-input">
              <span>/</span>
              <input
                maxLength={24}
                pattern="[a-z0-9-]{3,24}"
                value={draft.joinName}
                placeholder="kuopio"
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    joinName: event.target.value.toLowerCase(),
                  }));
                  setSaved(false);
                }}
              />
            </div>
            <small>3–24 lowercase letters, numbers, or hyphens.</small>
          </label>
          <fieldset className="language-field">
            <legend>Session language</legend>
            <div className="segmented-control">
              {(["en", "fi"] as const).map((language) => (
                <button
                  type="button"
                  className={draft.language === language ? "is-active" : ""}
                  aria-pressed={draft.language === language}
                  onClick={() => {
                    setDraft((current) => ({ ...current, language }));
                    setSaved(false);
                  }}
                  key={language}
                >
                  {language === "en" ? "English" : "Suomi"}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </section>

      <section className="editor-section">
        <div className="section-heading">
          <span className="step-number tabular">02</span>
          <div>
            <h2>Questions</h2>
            <p>Add them in the order the presenter will show them.</p>
          </div>
        </div>
        <div className="preset-bar">
          <span>Add a preset</span>
          <Button
            variant="quiet"
            onClick={() =>
              addQuestion({
                type: "single_choice",
                prompt: "",
                options: presetLabels.yesNo.map((label) => ({ label })),
              })
            }
          >
            Yes / No
          </Button>
          <Button
            variant="quiet"
            onClick={() =>
              addQuestion({
                type: "single_choice",
                prompt: "",
                options: presetLabels.agreement.map((label) => ({ label })),
              })
            }
          >
            Agreement scale
          </Button>
          <Button
            variant="quiet"
            onClick={() =>
              addQuestion({
                type: "single_choice",
                prompt: "",
                options: presetLabels.best.map((label) => ({ label })),
              })
            }
          >
            Best fit
          </Button>
          <Button
            variant="quiet"
            disabled={draft.questions.some((question) => question.type === "feedback")}
            onClick={() =>
              addQuestion({ type: "feedback", prompt: "", options: [] })
            }
          >
            Feedback
          </Button>
        </div>

        {draft.questions.length === 0 ? (
          <div className="editor-empty">
            <h3>No Questions yet</h3>
            <p>Start with one of the four presets above.</p>
          </div>
        ) : (
          <div className="question-editor-list">
            {draft.questions.map((question, index) => (
              <article className="question-editor" key={`${index}:${question.type}`}>
                <div className="question-editor__rail">
                  <span className="question-number tabular">{index + 1}</span>
                  <div className="reorder-buttons">
                    <button
                      type="button"
                      aria-label="Move Question up"
                      disabled={index === 0 || question.type === "feedback"}
                      onClick={() => {
                        setDraft((current) => {
                          const questions = [...current.questions];
                          [questions[index - 1], questions[index]] = [
                            questions[index]!,
                            questions[index - 1]!,
                          ];
                          return { ...current, questions };
                        });
                        setSaved(false);
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label="Move Question down"
                      disabled={
                        index === draft.questions.length - 1 ||
                        question.type === "feedback" ||
                        draft.questions[index + 1]?.type === "feedback"
                      }
                      onClick={() => {
                        setDraft((current) => {
                          const questions = [...current.questions];
                          [questions[index], questions[index + 1]] = [
                            questions[index + 1]!,
                            questions[index]!,
                          ];
                          return { ...current, questions };
                        });
                        setSaved(false);
                      }}
                    >
                      ↓
                    </button>
                  </div>
                </div>
                <div className="question-editor__body">
                  <div className="question-editor__topline">
                    <span className="question-type">
                      {question.type === "feedback" ? "Feedback" : "Single choice"}
                    </span>
                    <button
                      className="remove-button"
                      type="button"
                      onClick={() => {
                        setDraft((current) => ({
                          ...current,
                          questions: current.questions.filter(
                            (_, questionIndex) => questionIndex !== index,
                          ),
                        }));
                        setSaved(false);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                  <label>
                    <span className="sr-only">Question {index + 1}</span>
                    <textarea
                      className="question-prompt"
                      rows={2}
                      maxLength={240}
                      value={question.prompt}
                      placeholder="Type the Question…"
                      onChange={(event) =>
                        updateQuestion(index, (current) => ({
                          ...current,
                          prompt: event.target.value,
                        }))
                      }
                    />
                  </label>
                  {question.type === "single_choice" ? (
                    <div className="option-editor-list">
                      {question.options.map((option, optionIndex) => (
                        <div className="option-editor" key={optionIndex}>
                          <span className="option-letter" aria-hidden="true">
                            {String.fromCharCode(65 + optionIndex)}
                          </span>
                          <input
                            maxLength={100}
                            value={option.label}
                            aria-label={`Option ${optionIndex + 1}`}
                            onChange={(event) =>
                              updateQuestion(index, (current) => ({
                                ...current,
                                options: current.options.map((item, itemIndex) =>
                                  itemIndex === optionIndex
                                    ? { label: event.target.value }
                                    : item,
                                ),
                              }))
                            }
                          />
                          <button
                            type="button"
                            aria-label={`Remove Option ${optionIndex + 1}`}
                            disabled={question.options.length <= 2}
                            onClick={() =>
                              updateQuestion(index, (current) => ({
                                ...current,
                                options: current.options.filter(
                                  (_, itemIndex) => itemIndex !== optionIndex,
                                ),
                              }))
                            }
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      {question.options.length < 5 && (
                        <button
                          className="add-option"
                          type="button"
                          onClick={() =>
                            updateQuestion(index, (current) => ({
                              ...current,
                              options: [...current.options, { label: "" }],
                            }))
                          }
                        >
                          + Add Option
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="feedback-note">
                      Participants can submit one Comment of up to 160 characters. It will
                      appear on the live Comment Wall.
                    </p>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="editor-footer">
        <Button variant="secondary" disabled={busy} onClick={() => void save()}>
          Save Draft
        </Button>
        <Button disabled={busy || draft.questions.length === 0} onClick={start}>
          Start Session
        </Button>
      </div>
    </main>
  );
}
