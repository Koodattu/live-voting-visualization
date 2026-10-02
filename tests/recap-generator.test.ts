import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRecapGenerator, parseRecap, type RecapInput } from "../src/server/services/recap-generator.js";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = { create }; } }));

const input: RecapInput = {
  title: "Team confidence",
  language: "fi",
  questions: [{
    id: "q1", prompt: "Ready?", type: "single_choice", comments: [], commentsVisible: false,
    result: {
      responseCount: 4, participationDenominator: 5, participationPercentage: 80,
      options: [
        { id: "yes", position: 0, label: "Yes", count: 3, percentage: 75 },
        { id: "no", position: 1, label: "No", count: 1, percentage: 25 },
      ],
    },
  }],
};
const textRecap = { headline: "Mostly ready", summary: "Three of four respondents feel ready.", highlights: [], chart: null };
const chartRecap = (style = "bar") => ({
  ...textRecap,
  chart: { style, title: "Readiness", items: [
    { label: "Ready", questionId: "q1", optionIds: ["yes"] },
    { label: "Not ready", questionId: "q1", optionIds: ["no"] },
  ] },
});

describe("recap output", () => {
  it("accepts text-only summaries and calculates chart values from recorded votes", () => {
    expect(parseRecap(textRecap, input)).toEqual(textRecap);
    for (const style of ["bar", "donut"]) {
      const parsed = parseRecap(chartRecap(style), input);
      expect(parsed.chart?.items[0]).toEqual({
        label: "Ready", count: 3, total: 4, percentage: 75,
        sourceQuestion: "Ready?", sourceOptions: ["Yes"],
      });
    }
  });

  it("allows meaningful option groups and bar comparisons across questions", () => {
    const other = { ...input.questions[0]!, id: "q2", prompt: "Confident?" };
    const value = chartRecap();
    value.chart.items[0]!.optionIds = ["yes", "no"];
    value.chart.items[1]!.questionId = "q2";
    expect(parseRecap(value, { ...input, questions: [...input.questions, other] }).chart?.items[0]?.percentage).toBe(100);
    value.chart.style = "donut";
    expect(() => parseRecap(value, { ...input, questions: [...input.questions, other] })).toThrow();
  });

  it("rejects unknown references, duplicated options, empty data, and misleading donut partitions", () => {
    const badOption = chartRecap();
    badOption.chart.items[0]!.optionIds = ["invented"];
    expect(() => parseRecap(badOption, input)).toThrow();
    badOption.chart.items[0]!.optionIds = ["yes", "yes"];
    expect(() => parseRecap(badOption, input)).toThrow();
    expect(() => parseRecap(chartRecap(), { ...input, questions: [] })).toThrow();
    const empty = structuredClone(input);
    empty.questions[0]!.result!.responseCount = 0;
    expect(() => parseRecap(chartRecap(), empty)).toThrow();
    const overlap = chartRecap("donut");
    overlap.chart.items[1]!.optionIds = ["yes"];
    expect(() => parseRecap(overlap, input)).toThrow();
    const incomplete = structuredClone(input);
    incomplete.questions[0]!.result!.options.push({ id: "maybe", position: 2, label: "Maybe", count: 0, percentage: 0 });
    expect(() => parseRecap(chartRecap("donut"), incomplete)).toThrow();
  });

  it.each([
    { ...textRecap, headline: "x".repeat(91) },
    { ...textRecap, summary: " " },
    { ...textRecap, highlights: ["1", "2", "3", "4"] },
    { ...chartRecap(), chart: { ...chartRecap().chart, style: "html" } },
    { ...textRecap, chart: undefined },
  ])("rejects malformed or oversized output", (value) => {
    expect(() => parseRecap(value, input)).toThrow();
  });
});

describe("OpenAI recap request", () => {
  beforeEach(() => create.mockReset());

  it("uses the requested model, xhigh reasoning, structured output, and no stored response", async () => {
    create.mockResolvedValue({ status: "completed", output_text: JSON.stringify(textRecap), output: [] });
    const signal = new AbortController().signal;
    await expect(createRecapGenerator("test-key")!(input, signal)).resolves.toEqual(textRecap);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-6-luna", reasoning: { effort: "xhigh" }, store: false,
      input: JSON.stringify(input),
      text: { format: expect.objectContaining({ type: "json_schema", strict: true }) },
    }), { signal });
    expect(createRecapGenerator(undefined)).toBeUndefined();
  });

  it.each([
    { status: "incomplete", output_text: JSON.stringify(textRecap), output: [] },
    { status: "completed", output_text: "", output: [{ type: "message", content: [{ type: "refusal" }] }] },
    { status: "completed", output_text: "not json", output: [] },
  ])("rejects incomplete, refused, or invalid responses", async (response) => {
    create.mockResolvedValue(response);
    await expect(createRecapGenerator("test-key")!(input, new AbortController().signal)).rejects.toThrow();
  });
});
