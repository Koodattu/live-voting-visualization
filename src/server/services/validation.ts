import type {
  DraftQuestionInput,
  DraftSessionInput,
  SessionLanguage,
} from "../../shared/contracts.js";
import { AppError } from "../errors.js";

const RESERVED_JOIN_NAMES = new Set([
  "admin",
  "api",
  "assets",
  "display",
  "health",
  "login",
  "socket",
  "socket-io",
]);

function cleanText(
  value: unknown,
  field: string,
  maximumLength: number,
): string {
  if (typeof value !== "string") {
    throw new AppError("invalid_input", `${field} is required.`);
  }
  const cleaned = value.trim();
  if (cleaned.length === 0 || [...cleaned].length > maximumLength) {
    throw new AppError(
      "invalid_input",
      `${field} must contain 1–${maximumLength} characters.`,
    );
  }
  return cleaned;
}

export function normalizeJoinName(value: unknown): string {
  if (typeof value !== "string") {
    throw new AppError("invalid_join_name", "Enter a Join Name.");
  }
  const joinName = value.trim().toLowerCase();
  if (!/^[a-z0-9-]{3,24}$/.test(joinName)) {
    throw new AppError(
      "invalid_join_name",
      "Use 3–24 lowercase letters, numbers, or hyphens.",
    );
  }
  if (RESERVED_JOIN_NAMES.has(joinName)) {
    throw new AppError(
      "reserved_join_name",
      "That Join Name is reserved. Choose another one.",
    );
  }
  return joinName;
}

function normalizeQuestion(
  input: DraftQuestionInput,
  index: number,
): DraftQuestionInput {
  if (input.type !== "single_choice" && input.type !== "feedback") {
    throw new AppError("invalid_question", `Question ${index + 1} has an invalid type.`);
  }
  const prompt = cleanText(input.prompt, `Question ${index + 1}`, 240);
  const rawOptions = Array.isArray(input.options) ? input.options : [];

  if (input.type === "feedback") {
    if (rawOptions.length !== 0) {
      throw new AppError(
        "invalid_question",
        "A Feedback Question cannot contain Options.",
      );
    }
    return { type: input.type, prompt, options: [] };
  }

  if (rawOptions.length < 2 || rawOptions.length > 5) {
    throw new AppError(
      "invalid_question",
      `Question ${index + 1} must contain 2–5 Options.`,
    );
  }

  return {
    type: input.type,
    prompt,
    options: rawOptions.map((option, optionIndex) => ({
      label: cleanText(
        option.label,
        `Option ${optionIndex + 1} in Question ${index + 1}`,
        100,
      ),
    })),
  };
}

export function normalizeDraftInput(
  input: DraftSessionInput,
  requireQuestion = false,
): DraftSessionInput {
  const language: SessionLanguage = input.language;
  if (language !== "en" && language !== "fi") {
    throw new AppError("invalid_language", "Choose Finnish or English.");
  }
  if (!Array.isArray(input.questions)) {
    throw new AppError("invalid_question", "Questions must be a list.");
  }
  if (requireQuestion && input.questions.length === 0) {
    throw new AppError(
      "questions_required",
      "Add at least one valid Question before starting.",
    );
  }

  const questions = input.questions.map(normalizeQuestion);
  const feedbackIndex = questions.findIndex(
    (question) => question.type === "feedback",
  );
  if (
    feedbackIndex !== -1 &&
    feedbackIndex !== questions.length - 1
  ) {
    throw new AppError(
      "invalid_feedback_position",
      "The Feedback Question must be last.",
    );
  }
  if (
    questions.filter((question) => question.type === "feedback").length > 1
  ) {
    throw new AppError(
      "too_many_feedback_questions",
      "A session can contain one Feedback Question.",
    );
  }

  return {
    title: cleanText(input.title, "Title", 100),
    joinName: normalizeJoinName(input.joinName),
    language,
    questions,
  };
}

export function validateRequestId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 8 ||
    value.length > 100 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new AppError("invalid_request", "The request identifier is invalid.");
  }
  return value;
}
