import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCommentScreener } from "../src/server/services/comment-screening.js";
import { translate, translateResponseError } from "../src/client/i18n.js";

const { create, options } = vi.hoisted(() => ({ create: vi.fn(), options: vi.fn() }));
vi.mock("openai", () => ({ default: class {
  decisions = { create };
  constructor(input: unknown) { options(input); }
} }));
const input = { title: "Team pulse", question: "Any thoughts?", content: "Vittu, what a week!" };

describe("Decisions comment classification", () => {
  beforeEach(() => { create.mockReset(); options.mockClear(); });
  it("stays unavailable without a key", () => {
    expect(createCommentScreener(undefined)).toBeUndefined();
    expect(options).not.toHaveBeenCalled();
  });
  it.each([[0, true], [0.5, true], [0.979, true], [0.98, false], [1, false]])(
    "maps severe-abuse probability %s to suitable=%s", async (probability, suitable) => {
      create.mockResolvedValue({ answers: [{ type: "predicate", name: "severe_abuse", probability }] });
      expect(await createCommentScreener("test-key")!(input)).toEqual({ suitable, severeAbuseProbability: probability });
      expect(options).toHaveBeenCalledWith({ apiKey: "test-key", timeout: 10_000, maxRetries: 0 });
      expect(create).toHaveBeenCalledWith({
        model: "gpt-6-luna", input: JSON.stringify(input),
        questions: [{ type: "predicate", name: "severe_abuse", instructions: expect.any(String) }],
      });
    },
  );
  it.each([
    [], [{ type: "refusal", name: "severe_abuse" }],
    [{ type: "predicate", name: "different", probability: 0 }],
    ...[-1, 1.01, NaN, Infinity, "0.99", null].map((probability) => [{ type: "predicate", name: "severe_abuse", probability }]),
  ])("rejects missing, refused, and invalid decisions: %j", async (...answers) => {
    create.mockResolvedValue({ answers });
    await expect(createCommentScreener("test-key")!(input)).rejects.toThrow();
  });
  it("propagates API failures for the submission flow to handle", async () => {
    create.mockRejectedValue(new Error("API unavailable"));
    await expect(createCommentScreener("test-key")!(input)).rejects.toThrow("API unavailable");
  });
  it("localizes retry and rejection errors while preserving unknown fallbacks", () => {
    expect(translate("fi", "checkingComment")).toBe("Tarkistetaan kommenttia…");
    for (const code of ["comment_not_suitable", "comment_screening_unavailable", "response_pending", "session_changed"]) {
      expect(translateResponseError("fi", code, "fallback")).not.toBe("fallback");
      expect(translateResponseError("en", code, "English message")).toBe("English message");
    }
    expect(translateResponseError("fi", "unknown", "fallback")).toBe("fallback");
  });
});
