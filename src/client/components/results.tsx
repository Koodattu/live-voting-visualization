import { useEffect, useMemo, useState } from "react";
import type {
  ChoiceResult,
  DisplayQuestion,
  PublicComment,
  PublicQuestionResult,
  SessionLanguage,
} from "../../shared/contracts.js";
import { translate } from "../i18n.js";

export function ResultBars({
  result,
  compact = false,
}: {
  result: ChoiceResult;
  compact?: boolean;
}) {
  return (
    <div className={`result-bars${compact ? " result-bars--compact" : ""}`}>
      {result.options.map((option) => (
        <div className="result-row" key={option.id}>
          <div className="result-row__labels">
            <span>{option.label}</span>
            <span className="tabular">
              <strong>{option.percentage.toFixed(1)}%</strong>
              <small>{option.count}</small>
            </span>
          </div>
          <div className="result-track" aria-hidden="true">
            <span style={{ width: `${option.percentage}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

const VISIBLE_BUBBLES = 12;

export function CommentWall({
  comments,
  language,
}: {
  comments: PublicComment[];
  language: SessionLanguage;
}) {
  const [offset, setOffset] = useState(0);
  const recent = useMemo(() => comments.slice(-36), [comments]);

  useEffect(() => {
    setOffset(Math.max(0, recent.length - VISIBLE_BUBBLES));
    if (recent.length <= VISIBLE_BUBBLES) return;
    const timer = window.setInterval(() => {
      setOffset((current) =>
        (current + VISIBLE_BUBBLES) % recent.length,
      );
    }, 6_000);
    return () => window.clearInterval(timer);
  }, [recent]);

  const visible = Array.from(
    { length: Math.min(VISIBLE_BUBBLES, recent.length) },
    (_, index) => recent[(offset + index) % recent.length],
  ).filter((comment): comment is PublicComment => comment !== undefined);

  if (visible.length === 0) {
    return <p className="empty-result">{translate(language, "noResponses")}</p>;
  }

  return (
    <div className="comment-wall" aria-live="polite">
      {visible.map((comment, index) => (
        <div
          className={`comment-bubble comment-bubble--${(index % 6) + 1}`}
          key={`${comment.id}:${comment.updatedAt}`}
        >
          {comment.content}
        </div>
      ))}
    </div>
  );
}

export function CommentGrid({
  comments,
  language = "en",
  visible = true,
}: {
  comments: PublicComment[];
  language?: SessionLanguage;
  visible?: boolean;
}) {
  if (!visible) {
    return <p className="empty-result">{translate(language, "commentsHidden")}</p>;
  }
  if (comments.length === 0) {
    return <p className="empty-result">{translate(language, "noComments")}</p>;
  }
  return (
    <div className="comment-grid">
      {comments.map((comment) => (
        <blockquote key={comment.id}>{comment.content}</blockquote>
      ))}
    </div>
  );
}

export function QuestionResult({
  question,
  language,
  compact = false,
}: {
  question: DisplayQuestion | PublicQuestionResult;
  language: SessionLanguage;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "question-result question-result--compact" : "question-result"}>
      <h2>{question.prompt}</h2>
      {question.type === "single_choice" && question.result ? (
        <>
          <ResultBars result={question.result} compact={compact} />
          <p className="result-meta tabular">
            {question.result.responseCount} {translate(language, "responses")}
            <span aria-hidden="true"> · </span>
            {question.result.participationPercentage.toFixed(1)}%{" "}
            {translate(language, "participation")}
          </p>
        </>
      ) : (
        <CommentGrid
          comments={question.comments}
          language={language}
          visible={question.commentsVisible}
        />
      )}
    </div>
  );
}

export function SessionResults({
  title,
  language,
  results,
}: {
  title: string;
  language: SessionLanguage;
  results: PublicQuestionResult[];
}) {
  return (
    <main className="results-page">
      <header className="results-page__header stagger-item">
        <span className="eyebrow">{translate(language, "resultsTitle")}</span>
        <h1>{title}</h1>
        <p>{translate(language, "resultsBody")}</p>
      </header>
      {results.length === 0 ? (
        <section className="result-card stagger-item">
          <h2>{translate(language, "completed")}</h2>
          <p>{translate(language, "completedBody")}</p>
        </section>
      ) : (
        <div className="result-stack">
          {results.map((question, index) => (
            <section
              className="result-card stagger-item"
              style={{ animationDelay: `${Math.min(index, 5) * 80}ms` }}
              key={question.id}
            >
              <span className="question-number tabular">{index + 1}</span>
              <QuestionResult question={question} language={language} />
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
