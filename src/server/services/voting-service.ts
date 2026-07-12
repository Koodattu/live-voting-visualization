import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type Database from "better-sqlite3";
import type {
  AdminQuestion,
  AdminSessionDetail,
  AdminSessionSummary,
  ChoiceResult,
  DisplayQuestion,
  DisplaySnapshot,
  DraftSessionInput,
  GuestCredentials,
  LiveSessionSummary,
  OptionSummary,
  OwnResponse,
  ParticipantSnapshot,
  PresenterCommand,
  PublicComment,
  PublicQuestionResult,
  QuestionStatus,
  QuestionType,
  ResponseSubmission,
  SessionLanguage,
  SessionStatus,
} from "../../shared/contracts.js";
import { AppError } from "../errors.js";
import {
  normalizeDraftInput,
  normalizeJoinName,
  validateRequestId,
} from "./validation.js";

interface SessionRow {
  id: string;
  join_name: string;
  title: string;
  language: SessionLanguage;
  status: SessionStatus;
  presented_position: number | null;
  furthest_presented_position: number;
  display_theme: "light" | "dark";
  comment_wall_visible: 0 | 1;
  comments_public_at_end: 0 | 1 | null;
  control_revision: number;
  state_version: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  ended_at: string | null;
}

interface QuestionRow {
  id: string;
  session_id: string;
  position: number;
  type: QuestionType;
  prompt: string;
  status: QuestionStatus;
  opened_at: string | null;
  closed_at: string | null;
  participation_denominator: number | null;
}

interface OptionRow {
  id: string;
  question_id: string;
  position: number;
  label: string;
}

interface ReceiptRow {
  kind: string;
  payload_hash: string;
}

interface JoinResult {
  credentials: GuestCredentials | null;
  snapshot: ParticipantSnapshot;
  issued: boolean;
}

function now(): string {
  return new Date().toISOString();
}

function secretHash(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function payloadHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function percentage(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1_000) / 10;
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    String((error as Error & { code: unknown }).code).startsWith(
      "SQLITE_CONSTRAINT",
    )
  );
}

function asOption(row: OptionRow): OptionSummary {
  return { id: row.id, label: row.label, position: row.position };
}

export class VotingService {
  constructor(private readonly database: Database.Database) {}

  private sessionById(id: string): SessionRow | undefined {
    return this.database
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(id) as SessionRow | undefined;
  }

  private sessionByJoinName(joinName: string): SessionRow | undefined {
    return this.database
      .prepare("SELECT * FROM sessions WHERE join_name = ? COLLATE NOCASE")
      .get(joinName) as SessionRow | undefined;
  }

  private requireSessionById(id: string): SessionRow {
    const session = this.sessionById(id);
    if (!session) {
      throw new AppError("session_not_found", "Voting Session not found.", 404);
    }
    return session;
  }

  private requirePublicSession(joinName: string): SessionRow {
    const session = this.sessionByJoinName(normalizeJoinName(joinName));
    if (!session || session.status === "draft") {
      throw new AppError("session_not_found", "Voting Session not found.", 404);
    }
    return session;
  }

  private questions(sessionId: string): QuestionRow[] {
    return this.database
      .prepare(
        "SELECT * FROM questions WHERE session_id = ? ORDER BY position",
      )
      .all(sessionId) as QuestionRow[];
  }

  private questionAt(
    sessionId: string,
    position: number,
  ): QuestionRow | undefined {
    return this.database
      .prepare(
        "SELECT * FROM questions WHERE session_id = ? AND position = ?",
      )
      .get(sessionId, position) as QuestionRow | undefined;
  }

  private options(questionId: string): OptionRow[] {
    return this.database
      .prepare(
        "SELECT * FROM options WHERE question_id = ? ORDER BY position",
      )
      .all(questionId) as OptionRow[];
  }

  private guestCount(sessionId: string): number {
    const row = this.database
      .prepare(
        "SELECT count(*) AS count FROM guest_identities WHERE session_id = ?",
      )
      .get(sessionId) as { count: number };
    return row.count;
  }

  private choiceResult(
    session: SessionRow,
    question: QuestionRow,
  ): ChoiceResult {
    const optionRows = this.database
      .prepare(
        `SELECT options.id, options.label, options.position, count(votes.guest_id) AS count
         FROM options
         LEFT JOIN votes
           ON votes.question_id = options.question_id
          AND votes.option_id = options.id
         WHERE options.question_id = ?
         GROUP BY options.id, options.label, options.position
         ORDER BY options.position`,
      )
      .all(question.id) as Array<OptionRow & { count: number }>;
    const responseCount = optionRows.reduce(
      (total, option) => total + option.count,
      0,
    );
    const participationDenominator =
      question.status === "closed"
        ? (question.participation_denominator ?? 0)
        : this.guestCount(session.id);

    return {
      responseCount,
      participationDenominator,
      participationPercentage: percentage(
        responseCount,
        participationDenominator,
      ),
      options: optionRows.map((option) => ({
        ...asOption(option),
        count: option.count,
        percentage: percentage(option.count, responseCount),
      })),
    };
  }

  private comments(questionId: string): PublicComment[] {
    return (
      this.database
        .prepare(
          `SELECT guest_id, content, created_at, updated_at
           FROM comments
           WHERE question_id = ?
           ORDER BY updated_at, guest_id`,
        )
        .all(questionId) as Array<{
        guest_id: string;
        content: string;
        created_at: string;
        updated_at: string;
      }>
    ).map((row) => ({
      id: row.guest_id,
      content: row.content,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private displayQuestion(
    session: SessionRow,
    question: QuestionRow,
    includeHiddenComments: boolean,
  ): DisplayQuestion {
    const publicCommentsVisible =
      session.status === "ended"
        ? session.comments_public_at_end === 1
        : session.comment_wall_visible === 1;
    const commentsVisible =
      question.type === "feedback" &&
      (includeHiddenComments || publicCommentsVisible);
    return {
      id: question.id,
      position: question.position,
      type: question.type,
      prompt: question.prompt,
      status: question.status,
      options: this.options(question.id).map(asOption),
      result:
        question.type === "single_choice"
          ? this.choiceResult(session, question)
          : null,
      commentsVisible,
      comments: commentsVisible ? this.comments(question.id) : [],
    };
  }

  private ownResponse(
    question: QuestionRow | undefined,
    guestId: string | null,
  ): OwnResponse | null {
    if (!question || !guestId) return null;
    if (question.type === "single_choice") {
      const vote = this.database
        .prepare(
          `SELECT option_id, created_at, updated_at
           FROM votes WHERE question_id = ? AND guest_id = ?`,
        )
        .get(question.id, guestId) as
        | { option_id: string; created_at: string; updated_at: string }
        | undefined;
      return vote
        ? {
            questionId: question.id,
            optionId: vote.option_id,
            createdAt: vote.created_at,
            updatedAt: vote.updated_at,
          }
        : null;
    }

    const comment = this.database
      .prepare(
        `SELECT content, created_at, updated_at
         FROM comments WHERE question_id = ? AND guest_id = ?`,
      )
      .get(question.id, guestId) as
      | { content: string; created_at: string; updated_at: string }
      | undefined;
    return comment
      ? {
          questionId: question.id,
          content: comment.content,
          createdAt: comment.created_at,
          updatedAt: comment.updated_at,
        }
      : null;
  }

  private publicResults(session: SessionRow): PublicQuestionResult[] {
    if (session.status !== "ended") return [];
    return this.questions(session.id)
      .filter((question) => question.status === "closed")
      .map((question) => this.displayQuestion(session, question, false));
  }

  private summary(session: SessionRow): AdminSessionSummary {
    const counts = this.database
      .prepare(
        `SELECT
           (SELECT count(*) FROM guest_identities WHERE session_id = ?) AS joined_count,
           (SELECT count(*) FROM questions WHERE session_id = ?) AS question_count`,
      )
      .get(session.id, session.id) as {
      joined_count: number;
      question_count: number;
    };
    return {
      id: session.id,
      title: session.title,
      joinName: session.join_name,
      language: session.language,
      status: session.status,
      joinedCount: counts.joined_count,
      questionCount: counts.question_count,
      createdAt: session.created_at,
      startedAt: session.started_at,
      endedAt: session.ended_at,
    };
  }

  listAdminSessions(): AdminSessionSummary[] {
    return (
      this.database
        .prepare(
          `SELECT * FROM sessions
           ORDER BY
             CASE status WHEN 'live' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
             created_at DESC`,
        )
        .all() as SessionRow[]
    ).map((session) => this.summary(session));
  }

  listLiveSessions(): LiveSessionSummary[] {
    return (
      this.database
        .prepare(
          `SELECT sessions.*,
             (SELECT count(*) FROM guest_identities
              WHERE session_id = sessions.id) AS joined_count
           FROM sessions
           WHERE status = 'live'
           ORDER BY started_at DESC, title COLLATE NOCASE`,
        )
        .all() as Array<SessionRow & { joined_count: number }>
    ).map((session) => ({
      id: session.id,
      title: session.title,
      joinName: session.join_name,
      language: session.language,
      joinedCount: session.joined_count,
      stage: session.presented_position === null ? "lobby" : "question",
    }));
  }

  adminSnapshot(sessionId: string): AdminSessionDetail {
    const session = this.requireSessionById(sessionId);
    const questions: AdminQuestion[] = this.questions(session.id).map(
      (question) => ({
        ...this.displayQuestion(session, question, true),
        openedAt: question.opened_at,
        closedAt: question.closed_at,
        participationDenominator: question.participation_denominator,
      }),
    );
    return {
      role: "admin",
      ...this.summary(session),
      stateVersion: session.state_version,
      controlRevision: session.control_revision,
      displayTheme: session.display_theme,
      commentWallVisible: session.comment_wall_visible === 1,
      presentedPosition: session.presented_position,
      furthestPresentedPosition: session.furthest_presented_position,
      questions,
    };
  }

  participantSnapshot(
    sessionId: string,
    guestId: string | null,
  ): ParticipantSnapshot {
    const session = this.requireSessionById(sessionId);
    if (session.status === "draft") {
      throw new AppError("session_not_found", "Voting Session not found.", 404);
    }
    const current =
      session.status === "live" && session.presented_position !== null
        ? this.questionAt(session.id, session.presented_position)
        : undefined;
    return {
      role: "participant",
      sessionId: session.id,
      title: session.title,
      joinName: session.join_name,
      language: session.language,
      status: session.status,
      stateVersion: session.state_version,
      joinedCount: this.guestCount(session.id),
      currentQuestion: current
        ? {
            id: current.id,
            position: current.position,
            type: current.type,
            prompt: current.prompt,
            status: current.status,
            options: this.options(current.id).map(asOption),
          }
        : null,
      ownResponse: this.ownResponse(current, guestId),
      results: this.publicResults(session),
    };
  }

  displaySnapshot(sessionId: string): DisplaySnapshot {
    const session = this.requireSessionById(sessionId);
    if (session.status === "draft") {
      throw new AppError("session_not_found", "Voting Session not found.", 404);
    }
    const current =
      session.presented_position === null
        ? undefined
        : this.questionAt(session.id, session.presented_position);
    const previous =
      current && current.position > 0
        ? this.questionAt(session.id, current.position - 1)
        : undefined;
    return {
      role: "display",
      sessionId: session.id,
      title: session.title,
      joinName: session.join_name,
      language: session.language,
      status: session.status,
      stateVersion: session.state_version,
      displayTheme: session.display_theme,
      commentWallVisible: session.comment_wall_visible === 1,
      joinedCount: this.guestCount(session.id),
      currentQuestion: current
        ? this.displayQuestion(session, current, false)
        : null,
      previousQuestion:
        previous?.status === "closed"
          ? this.displayQuestion(session, previous, false)
          : null,
    };
  }

  publicSessionByJoinName(joinName: string): SessionRow {
    return this.requirePublicSession(joinName);
  }

  private insertQuestions(
    sessionId: string,
    questions: DraftSessionInput["questions"],
  ): void {
    const insertQuestion = this.database.prepare(
      `INSERT INTO questions
        (id, session_id, position, type, prompt, status)
       VALUES (?, ?, ?, ?, ?, 'unshown')`,
    );
    const insertOption = this.database.prepare(
      `INSERT INTO options (id, question_id, position, label)
       VALUES (?, ?, ?, ?)`,
    );
    questions.forEach((question, questionPosition) => {
      const questionId = randomUUID();
      insertQuestion.run(
        questionId,
        sessionId,
        questionPosition,
        question.type,
        question.prompt,
      );
      question.options.forEach((option, optionPosition) => {
        insertOption.run(
          randomUUID(),
          questionId,
          optionPosition,
          option.label,
        );
      });
    });
  }

  createDraft(input: DraftSessionInput): AdminSessionDetail {
    const draft = normalizeDraftInput(input);
    const sessionId = randomUUID();
    const createdAt = now();
    const create = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO sessions
            (id, join_name, title, language, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sessionId,
          draft.joinName,
          draft.title,
          draft.language,
          createdAt,
          createdAt,
        );
      this.insertQuestions(sessionId, draft.questions);
    });

    try {
      create.immediate();
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new AppError(
          "join_name_taken",
          "That Join Name is already in use.",
          409,
        );
      }
      throw error;
    }
    return this.adminSnapshot(sessionId);
  }

  updateDraft(
    sessionId: string,
    input: DraftSessionInput,
    expectedControlRevision: number,
  ): AdminSessionDetail {
    const draft = normalizeDraftInput(input);
    const update = this.database.transaction(() => {
      const session = this.requireSessionById(sessionId);
      if (session.status !== "draft") {
        throw new AppError(
          "session_frozen",
          "Questions cannot be changed after the session starts.",
          409,
        );
      }
      if (session.control_revision !== expectedControlRevision) {
        throw new AppError(
          "stale_revision",
          "This session changed in another browser. Reload and try again.",
          409,
        );
      }
      this.database
        .prepare("DELETE FROM questions WHERE session_id = ?")
        .run(sessionId);
      this.insertQuestions(sessionId, draft.questions);
      this.database
        .prepare(
          `UPDATE sessions
           SET join_name = ?, title = ?, language = ?, updated_at = ?,
               control_revision = control_revision + 1,
               state_version = state_version + 1
           WHERE id = ?`,
        )
        .run(draft.joinName, draft.title, draft.language, now(), sessionId);
    });

    try {
      update.immediate();
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new AppError(
          "join_name_taken",
          "That Join Name is already in use.",
          409,
        );
      }
      throw error;
    }
    return this.adminSnapshot(sessionId);
  }

  private receiptIsDuplicate(
    sessionId: string,
    actorKey: string,
    requestId: string,
    kind: string,
    hash: string,
  ): boolean {
    const receipt = this.database
      .prepare(
        `SELECT kind, payload_hash FROM request_receipts
         WHERE session_id = ? AND actor_key = ? AND request_id = ?`,
      )
      .get(sessionId, actorKey, requestId) as ReceiptRow | undefined;
    if (!receipt) return false;
    if (receipt.kind !== kind || receipt.payload_hash !== hash) {
      throw new AppError(
        "request_id_reused",
        "That request identifier was already used for another action.",
        409,
      );
    }
    return true;
  }

  private saveReceipt(
    sessionId: string,
    actorKey: string,
    requestId: string,
    kind: string,
    hash: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO request_receipts
          (session_id, actor_key, request_id, kind, payload_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(sessionId, actorKey, requestId, kind, hash, now());
  }

  private validateStoredQuestions(sessionId: string): void {
    const questions = this.questions(sessionId);
    if (questions.length === 0) {
      throw new AppError(
        "questions_required",
        "Add at least one valid Question before starting.",
      );
    }
    questions.forEach((question, index) => {
      const optionCount = this.options(question.id).length;
      if (
        (question.type === "single_choice" &&
          (optionCount < 2 || optionCount > 5)) ||
        (question.type === "feedback" && optionCount !== 0) ||
        (question.type === "feedback" && index !== questions.length - 1)
      ) {
        throw new AppError(
          "invalid_question",
          "Fix the Question set before starting.",
        );
      }
    });
  }

  startSession(
    sessionId: string,
    expectedControlRevision: number,
    rawRequestId: string,
  ): AdminSessionDetail {
    const requestId = validateRequestId(rawRequestId);
    const hash = payloadHash({ action: "start", expectedControlRevision });
    const start = this.database.transaction(() => {
      if (
        this.receiptIsDuplicate(
          sessionId,
          "presenter",
          requestId,
          "start",
          hash,
        )
      ) {
        return;
      }
      const session = this.requireSessionById(sessionId);
      if (session.status !== "draft") {
        throw new AppError(
          "invalid_session_state",
          "Only a Draft Session can start.",
          409,
        );
      }
      if (session.control_revision !== expectedControlRevision) {
        throw new AppError(
          "stale_revision",
          "This session changed in another browser. Reload and try again.",
          409,
        );
      }
      this.validateStoredQuestions(sessionId);
      const timestamp = now();
      this.database
        .prepare(
          `UPDATE sessions
           SET status = 'live', started_at = ?, updated_at = ?,
               control_revision = control_revision + 1,
               state_version = state_version + 1
           WHERE id = ?`,
        )
        .run(timestamp, timestamp, sessionId);
      this.saveReceipt(
        sessionId,
        "presenter",
        requestId,
        "start",
        hash,
      );
    });
    start.immediate();
    return this.adminSnapshot(sessionId);
  }

  runPresenterCommand(
    sessionId: string,
    command: PresenterCommand,
  ): AdminSessionDetail {
    const requestId = validateRequestId(command.requestId);
    const kind = `presenter:${command.action}`;
    const hash = payloadHash({
      action: command.action,
      expectedControlRevision: command.expectedControlRevision,
      value: command.value,
    });
    const transition = this.database.transaction(() => {
      if (
        this.receiptIsDuplicate(
          sessionId,
          "presenter",
          requestId,
          kind,
          hash,
        )
      ) {
        return;
      }
      const session = this.requireSessionById(sessionId);
      if (session.status !== "live") {
        throw new AppError(
          "invalid_session_state",
          "This Voting Session is not live.",
          409,
        );
      }
      if (session.control_revision !== command.expectedControlRevision) {
        throw new AppError(
          "stale_revision",
          "Presenter state changed in another browser. The latest state has been restored.",
          409,
        );
      }

      const current =
        session.presented_position === null
          ? undefined
          : this.questionAt(session.id, session.presented_position);
      const hasOpenQuestion = current?.status === "open";
      const timestamp = now();

      switch (command.action) {
        case "open_first": {
          if (session.presented_position !== null) {
            throw new AppError(
              "invalid_transition",
              "The first Question has already been presented.",
              409,
            );
          }
          const first = this.questionAt(session.id, 0);
          if (!first || first.status !== "unshown") {
            throw new AppError(
              "invalid_transition",
              "The first Question cannot be opened.",
              409,
            );
          }
          this.database
            .prepare(
              `UPDATE questions SET status = 'open', opened_at = ? WHERE id = ?`,
            )
            .run(timestamp, first.id);
          this.database
            .prepare(
              `UPDATE sessions
               SET presented_position = 0, furthest_presented_position = 0
               WHERE id = ?`,
            )
            .run(session.id);
          break;
        }
        case "close": {
          if (!current || !hasOpenQuestion) {
            throw new AppError(
              "invalid_transition",
              "There is no Open Question to close.",
              409,
            );
          }
          this.database
            .prepare(
              `UPDATE questions
               SET status = 'closed', closed_at = ?, participation_denominator = ?
               WHERE id = ?`,
            )
            .run(timestamp, this.guestCount(session.id), current.id);
          break;
        }
        case "previous": {
          if (hasOpenQuestion) {
            throw new AppError(
              "question_open",
              "Close the Question before navigating.",
              409,
            );
          }
          if (!current || current.position === 0) {
            throw new AppError(
              "invalid_transition",
              "There is no previous Question.",
              409,
            );
          }
          const previous = this.questionAt(session.id, current.position - 1);
          if (!previous || previous.status !== "closed") {
            throw new AppError(
              "invalid_transition",
              "The previous Question is unavailable.",
              409,
            );
          }
          this.database
            .prepare(
              "UPDATE sessions SET presented_position = ? WHERE id = ?",
            )
            .run(previous.position, session.id);
          break;
        }
        case "next": {
          if (hasOpenQuestion) {
            throw new AppError(
              "question_open",
              "Close the Question before navigating.",
              409,
            );
          }
          if (!current) {
            throw new AppError(
              "invalid_transition",
              "Open the first Question from the Lobby.",
              409,
            );
          }
          const next = this.questionAt(session.id, current.position + 1);
          if (!next) {
            throw new AppError(
              "invalid_transition",
              "There is no next Question.",
              409,
            );
          }
          if (current.position < session.furthest_presented_position) {
            if (next.status !== "closed") {
              throw new AppError(
                "invalid_transition",
                "Questions must be shown in order.",
                409,
              );
            }
            this.database
              .prepare(
                "UPDATE sessions SET presented_position = ? WHERE id = ?",
              )
              .run(next.position, session.id);
          } else {
            if (next.status !== "unshown") {
              throw new AppError(
                "invalid_transition",
                "The next Question cannot be opened.",
                409,
              );
            }
            this.database
              .prepare(
                `UPDATE questions SET status = 'open', opened_at = ? WHERE id = ?`,
              )
              .run(timestamp, next.id);
            this.database
              .prepare(
                `UPDATE sessions
                 SET presented_position = ?, furthest_presented_position = ?
                 WHERE id = ?`,
              )
              .run(next.position, next.position, session.id);
          }
          break;
        }
        case "end": {
          if (hasOpenQuestion) {
            throw new AppError(
              "question_open",
              "Close the Question before ending the session.",
              409,
            );
          }
          this.database
            .prepare(
              `UPDATE sessions
               SET status = 'ended', ended_at = ?,
                   comments_public_at_end = comment_wall_visible
               WHERE id = ?`,
            )
            .run(timestamp, session.id);
          break;
        }
        case "toggle_theme": {
          this.database
            .prepare(
              `UPDATE sessions
               SET display_theme = CASE display_theme
                 WHEN 'light' THEN 'dark' ELSE 'light' END
               WHERE id = ?`,
            )
            .run(session.id);
          break;
        }
        case "set_comment_wall": {
          if (typeof command.value !== "boolean") {
            throw new AppError(
              "invalid_command",
              "Choose whether the Comment Wall is visible.",
            );
          }
          this.database
            .prepare(
              "UPDATE sessions SET comment_wall_visible = ? WHERE id = ?",
            )
            .run(command.value ? 1 : 0, session.id);
          break;
        }
        default: {
          throw new AppError(
            "invalid_command",
            "Choose a valid Presenter action.",
          );
        }
      }

      this.database
        .prepare(
          `UPDATE sessions
           SET control_revision = control_revision + 1,
               state_version = state_version + 1,
               updated_at = ?
           WHERE id = ?`,
        )
        .run(timestamp, session.id);
      this.saveReceipt(
        sessionId,
        "presenter",
        requestId,
        kind,
        hash,
      );
    });
    transition.immediate();
    return this.adminSnapshot(sessionId);
  }

  private verifyGuest(
    sessionId: string,
    guestId: string,
    secret: string,
  ): boolean {
    const row = this.database
      .prepare(
        `SELECT secret_hash FROM guest_identities
         WHERE session_id = ? AND id = ?`,
      )
      .get(sessionId, guestId) as { secret_hash: string } | undefined;
    if (!row || !/^[a-f0-9]{64}$/.test(row.secret_hash)) return false;
    const stored = Buffer.from(row.secret_hash, "hex");
    return timingSafeEqual(stored, secretHash(secret));
  }

  verifyGuestCredentials(
    joinName: string,
    credentials: GuestCredentials | undefined,
  ): { sessionId: string; guestId: string } {
    const session = this.requirePublicSession(joinName);
    if (
      session.status !== "live" ||
      !credentials ||
      credentials.sessionId !== session.id ||
      !this.verifyGuest(session.id, credentials.guestId, credentials.secret)
    ) {
      throw new AppError(
        "invalid_guest",
        "Join this Voting Session before responding.",
        401,
      );
    }
    return { sessionId: session.id, guestId: credentials.guestId };
  }

  joinSession(
    joinName: string,
    existing: GuestCredentials | undefined,
  ): JoinResult {
    const initialSession = this.requirePublicSession(joinName);
    if (initialSession.status === "ended") {
      return {
        credentials: null,
        snapshot: this.participantSnapshot(initialSession.id, null),
        issued: false,
      };
    }

    const join = this.database.transaction((): {
      credentials: GuestCredentials;
      issued: boolean;
    } => {
      const session = this.requirePublicSession(joinName);
      if (session.status !== "live") {
        throw new AppError(
          "session_ended",
          "This Voting Session has ended.",
          409,
        );
      }
      if (
        existing?.sessionId === session.id &&
        this.verifyGuest(session.id, existing.guestId, existing.secret)
      ) {
        return { credentials: existing, issued: false };
      }

      const guestId = `guest-${randomBytes(8).toString("hex")}`;
      const secret = randomBytes(32).toString("base64url");
      this.database
        .prepare(
          `INSERT INTO guest_identities (id, session_id, secret_hash, joined_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(guestId, session.id, secretHash(secret).toString("hex"), now());
      this.database
        .prepare(
          `UPDATE sessions
           SET state_version = state_version + 1, updated_at = ?
           WHERE id = ?`,
        )
        .run(now(), session.id);
      return {
        credentials: { sessionId: session.id, guestId, secret },
        issued: true,
      };
    });
    const joined = join.immediate();
    return {
      credentials: joined.credentials,
      snapshot: this.participantSnapshot(
        initialSession.id,
        joined.credentials.guestId,
      ),
      issued: joined.issued,
    };
  }

  submitResponse(
    sessionId: string,
    guestId: string,
    submission: ResponseSubmission,
  ): ParticipantSnapshot {
    const requestId = validateRequestId(submission.requestId);
    const hash = payloadHash({
      questionId: submission.questionId,
      optionId: submission.optionId,
      content: submission.content,
    });
    const submit = this.database.transaction(() => {
      if (
        this.receiptIsDuplicate(
          sessionId,
          guestId,
          requestId,
          "response",
          hash,
        )
      ) {
        return;
      }
      const session = this.requireSessionById(sessionId);
      if (session.status !== "live") {
        throw new AppError(
          "session_not_live",
          "This Voting Session is no longer accepting responses.",
          409,
        );
      }
      const question = this.database
        .prepare(
          `SELECT * FROM questions WHERE id = ? AND session_id = ?`,
        )
        .get(submission.questionId, sessionId) as QuestionRow | undefined;
      if (
        !question ||
        question.status !== "open" ||
        question.position !== session.presented_position
      ) {
        throw new AppError(
          "question_not_open",
          "This Question is no longer accepting responses.",
          409,
        );
      }
      const timestamp = now();
      if (question.type === "single_choice") {
        if (typeof submission.optionId !== "string") {
          throw new AppError("option_required", "Choose one Option.");
        }
        const option = this.database
          .prepare(
            "SELECT id FROM options WHERE id = ? AND question_id = ?",
          )
          .get(submission.optionId, question.id);
        if (!option) {
          throw new AppError(
            "invalid_option",
            "That Option does not belong to this Question.",
          );
        }
        this.database
          .prepare(
            `INSERT INTO votes
              (session_id, question_id, guest_id, option_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(question_id, guest_id) DO UPDATE SET
               option_id = excluded.option_id,
               updated_at = excluded.updated_at`,
          )
          .run(
            session.id,
            question.id,
            guestId,
            submission.optionId,
            timestamp,
            timestamp,
          );
      } else {
        if (typeof submission.content !== "string") {
          throw new AppError("comment_required", "Enter a short Comment.");
        }
        const content = submission.content.trim();
        if (content.length === 0 || [...content].length > 160) {
          throw new AppError(
            "invalid_comment",
            "Comments must contain 1–160 characters.",
          );
        }
        this.database
          .prepare(
            `INSERT INTO comments
              (session_id, question_id, guest_id, content, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(question_id, guest_id) DO UPDATE SET
               content = excluded.content,
               updated_at = excluded.updated_at`,
          )
          .run(
            session.id,
            question.id,
            guestId,
            content,
            timestamp,
            timestamp,
          );
      }
      this.database
        .prepare(
          `UPDATE sessions
           SET state_version = state_version + 1, updated_at = ?
           WHERE id = ?`,
        )
        .run(timestamp, session.id);
      this.saveReceipt(
        sessionId,
        guestId,
        requestId,
        "response",
        hash,
      );
    });
    submit.immediate();
    return this.participantSnapshot(sessionId, guestId);
  }

  duplicateEndedSession(
    sourceSessionId: string,
    newJoinName: string,
  ): AdminSessionDetail {
    const joinName = normalizeJoinName(newJoinName);
    const source = this.requireSessionById(sourceSessionId);
    if (source.status !== "ended") {
      throw new AppError(
        "invalid_session_state",
        "Only an Ended Session can be duplicated.",
        409,
      );
    }
    const input: DraftSessionInput = {
      title: source.title,
      joinName,
      language: source.language,
      questions: this.questions(source.id).map((question) => ({
        type: question.type,
        prompt: question.prompt,
        options: this.options(question.id).map((option) => ({
          label: option.label,
        })),
      })),
    };
    return this.createDraft(input);
  }

  deleteSession(
    sessionId: string,
    confirmation: string | boolean | undefined,
  ): void {
    const remove = this.database.transaction(() => {
      const session = this.requireSessionById(sessionId);
      if (session.status === "live") {
        throw new AppError(
          "live_session_cannot_be_deleted",
          "End the Voting Session before deleting it.",
          409,
        );
      }
      if (
        session.status === "ended" &&
        (typeof confirmation !== "string" ||
          confirmation.trim().toLowerCase() !== session.join_name)
      ) {
        throw new AppError(
          "confirmation_mismatch",
          "Type the Join Name to confirm deletion.",
        );
      }
      if (
        session.status === "draft" &&
        confirmation !== true &&
        confirmation !== "true"
      ) {
        throw new AppError(
          "confirmation_required",
          "Confirm deletion of this Draft Session.",
        );
      }
      this.database.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
    });
    remove.immediate();
  }

  exportCsv(sessionId: string): { filename: string; csv: string } {
    const session = this.requireSessionById(sessionId);
    if (session.status !== "ended") {
      throw new AppError(
        "session_not_ended",
        "Responses can be exported after the session ends.",
        409,
      );
    }
    const voteRows = this.database
      .prepare(
        `SELECT questions.position, questions.prompt, options.label AS response,
                votes.guest_id, votes.created_at, votes.updated_at
         FROM votes
         JOIN questions ON questions.id = votes.question_id
         JOIN options ON options.id = votes.option_id
         WHERE votes.session_id = ? AND questions.status = 'closed'`,
      )
      .all(sessionId) as Array<{
      position: number;
      prompt: string;
      response: string;
      guest_id: string;
      created_at: string;
      updated_at: string;
    }>;
    const commentRows = this.database
      .prepare(
        `SELECT questions.position, questions.prompt, comments.content AS response,
                comments.guest_id, comments.created_at, comments.updated_at
         FROM comments
         JOIN questions ON questions.id = comments.question_id
         WHERE comments.session_id = ? AND questions.status = 'closed'`,
      )
      .all(sessionId) as typeof voteRows;
    const rows = [
      ...voteRows.map((row) => ({ ...row, type: "vote" })),
      ...commentRows.map((row) => ({ ...row, type: "comment" })),
    ].sort(
      (left, right) =>
        left.position - right.position ||
        left.created_at.localeCompare(right.created_at) ||
        left.guest_id.localeCompare(right.guest_id),
    );

    const neutralize = (value: string): string =>
      /^[\u0000-\u0020]*[=+\-@]/.test(value) ? `'${value}` : value;
    const quote = (value: string): string =>
      `"${neutralize(value).replaceAll('"', '""')}"`;
    const lines = [
      ["Question", "Response", "Type", "Guest Identity", "Created at", "Updated at"],
      ...rows.map((row) => [
        row.prompt,
        row.response,
        row.type,
        row.guest_id,
        row.created_at,
        row.updated_at,
      ]),
    ].map((row) => row.map(quote).join(","));

    return {
      filename: `${session.join_name}-responses.csv`,
      csv: `\uFEFF${lines.join("\r\n")}\r\n`,
    };
  }
}
