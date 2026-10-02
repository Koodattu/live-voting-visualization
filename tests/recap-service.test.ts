import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminSessionDetail, DraftSessionInput, PresenterAction, RecapContent } from "../src/shared/contracts.js";
import { openDatabase, type DatabaseHandle } from "../src/server/db/database.js";
import { VotingService } from "../src/server/services/voting-service.js";
import type { RecapGenerator } from "../src/server/services/recap-generator.js";
import { testConfig } from "./helpers.js";

const content: RecapContent = { headline: "Ready to go", summary: "The audience is ready.", highlights: [], chart: null };
const draft: DraftSessionInput = {
  title: "Team pulse", joinName: "team-pulse", language: "en", lockQuestions: true, aiRecapEnabled: true,
  questions: [
    { type: "single_choice", prompt: "Ready?", options: [{ label: "Yes" }, { label: "No" }] },
    { type: "feedback", prompt: "Any thoughts?", options: [] },
  ],
};

describe("optional AI recap lifecycle", () => {
  let handle: DatabaseHandle;
  let service: VotingService;
  const changed = vi.fn();

  async function setup(generate?: RecapGenerator, overrides: Partial<DraftSessionInput> = {}) {
    handle = await openDatabase(await testConfig());
    service = new VotingService(handle.database, generate, changed);
    const created = service.createDraft({ ...draft, ...overrides });
    return service.startSession(created.id, created.controlRevision, randomUUID());
  }
  function command(session: AdminSessionDetail, action: PresenterAction, value?: boolean) {
    return service.runPresenterCommand(session.id, { action, value, requestId: randomUUID(), expectedControlRevision: session.controlRevision });
  }
  function finishQuestions(session: AdminSessionDetail) {
    session = command(session, "open_first");
    return command(session, "next");
  }
  afterEach(async () => {
    if (service) await service.close();
    if (handle) await handle.close();
    changed.mockClear();
  });

  it("defaults off, validates the toggle, preserves it when duplicating, and resets generated content", async () => {
    let session = await setup(undefined, { aiRecapEnabled: undefined });
    expect(session.aiRecapEnabled).toBe(false);
    expect(() => service.createDraft({ ...draft, aiRecapEnabled: "yes" as unknown as boolean })).toThrow();
    session = finishQuestions(session);
    expect(() => command(session, "next")).toThrow();
    session = command(session, "end");
    expect(session.recapVisible).toBe(false);
    const copy = service.duplicateEndedSession(session.id, "copy-off");
    expect(copy.aiRecapEnabled).toBe(false);
    const edited = service.updateDraft(copy.id, { ...draft, joinName: copy.joinName }, copy.controlRevision);
    expect(edited.aiRecapEnabled).toBe(true);
    expect(edited.recap).toEqual({ status: "idle", content: null });
  });

  it("generates once after closing the last question, sends all visible context without guest identities, and persists the result", async () => {
    let resolve!: (content: RecapContent) => void;
    const generate = vi.fn<RecapGenerator>(() => new Promise((done) => { resolve = done; }));
    let session = await setup(generate);
    const guest = service.joinSession(session.joinName, undefined).credentials!;
    session = command(session, "open_first");
    service.submitResponse(session.id, guest.guestId, { requestId: randomUUID(), questionId: session.questions[0]!.id, optionId: session.questions[0]!.options[0]!.id });
    session = command(session, "next");
    service.submitResponse(session.id, guest.guestId, { requestId: randomUUID(), questionId: session.questions[1]!.id, content: "Excited about the next steps" });
    expect(generate).not.toHaveBeenCalled();
    const next = { action: "next" as const, requestId: randomUUID(), expectedControlRevision: session.controlRevision };
    session = service.runPresenterCommand(session.id, next);
    service.runPresenterCommand(session.id, next);
    expect(session.recapVisible).toBe(true);
    expect(session.questions.every((question) => question.status === "closed")).toBe(true);
    expect(session.recap.status).toBe("generating");
    expect(service.participantSnapshot(session.id, guest.guestId).recap).toBeNull();
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    const input = generate.mock.calls[0]![0];
    expect(input.title).toBe(draft.title);
    expect(input.questions).toHaveLength(2);
    expect(input.questions[0]?.result?.responseCount).toBe(1);
    expect(input.questions[1]?.comments).toEqual(["Excited about the next steps"]);
    expect(JSON.stringify(input)).not.toContain(guest.guestId);
    expect(JSON.stringify(input)).not.toContain(guest.secret);
    expect(() => service.submitResponse(session.id, guest.guestId, { requestId: randomUUID(), questionId: session.questions[1]!.id, content: "Too late" })).toThrow();
    resolve(content);
    await vi.waitFor(() => expect(service.adminSnapshot(session.id).recap.status).toBe("ready"));
    expect(changed).toHaveBeenCalledTimes(1);
    session = command(service.adminSnapshot(session.id), "previous");
    expect(session.presentedPosition).toBe(1);
    expect(session.questions[1]?.status).toBe("closed");
    session = command(session, "next");
    expect(session.recap.content).toEqual(content);
    expect(generate).toHaveBeenCalledTimes(1);
    session = command(session, "end");
    expect(service.participantSnapshot(session.id, null).recap?.content).toEqual(content);
    await service.close();
    service = new VotingService(handle.database, generate, changed);
    expect(service.displaySnapshot(session.id).recap?.content).toEqual(content);
    const copy = service.duplicateEndedSession(session.id, "copy-on");
    expect(copy.aiRecapEnabled).toBe(true);
    expect(copy.recap.content).toBeNull();
    expect(copy.recapVisible).toBe(false);
  });

  it("invalidates an in-flight recap on reopened voting and ignores its stale result", async () => {
    const resolvers: Array<(value: RecapContent) => void> = [];
    const generate = vi.fn<RecapGenerator>(() => new Promise((resolve) => resolvers.push(resolve)));
    let session = await setup(generate, { lockQuestions: false });
    session = command(finishQuestions(session), "next");
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    session = command(session, "previous");
    expect(session.questions[1]?.status).toBe("open");
    expect(session.recap.status).toBe("idle");
    expect(generate.mock.calls[0]![1].aborted).toBe(true);
    session = command(session, "next");
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    resolvers[0]!({ ...content, headline: "Stale result" });
    await Promise.resolve();
    expect(service.adminSnapshot(session.id).recap.status).toBe("generating");
    resolvers[1]!(content);
    await vi.waitFor(() => expect(service.adminSnapshot(session.id).recap.content).toEqual(content));
  });

  it("excludes hidden comments and replaces a recap when Comment Wall visibility changes", async () => {
    const generate = vi.fn<RecapGenerator>().mockResolvedValue(content);
    let session = await setup(generate);
    const guest = service.joinSession(session.joinName, undefined).credentials!;
    session = finishQuestions(session);
    service.submitResponse(session.id, guest.guestId, { requestId: randomUUID(), questionId: session.questions[1]!.id, content: "Hidden feedback" });
    session = command(session, "set_comment_wall", false);
    session = command(session, "next");
    await vi.waitFor(() => expect(service.adminSnapshot(session.id).recap.status).toBe("ready"));
    expect(generate.mock.calls[0]![0].questions[1]?.comments).toEqual([]);
    expect(generate.mock.calls[0]![0].questions[1]?.commentsVisible).toBe(false);
    session = command(service.adminSnapshot(session.id), "set_comment_wall", true);
    expect(session.recap.content).toBeNull();
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    expect(generate.mock.calls[1]![0].questions[1]?.comments).toEqual(["Hidden feedback"]);
  });

  it("supports failure and explicit retry after End, without changing the control revision on completion", async () => {
    const generate = vi.fn<RecapGenerator>().mockRejectedValueOnce(new Error("Provider unavailable")).mockResolvedValueOnce(content);
    let session = await setup(generate);
    session = command(finishQuestions(session), "end");
    await vi.waitFor(() => expect(service.adminSnapshot(session.id).recap.status).toBe("failed"));
    const failed = service.adminSnapshot(session.id);
    expect(failed.controlRevision).toBe(session.controlRevision);
    expect(failed.stateVersion).toBeGreaterThan(session.stateVersion);
    session = command(failed, "retry_recap");
    expect(() => command(session, "retry_recap")).toThrow();
    await vi.waitFor(() => expect(service.displaySnapshot(session.id).recap?.status).toBe("ready"));
    expect(generate).toHaveBeenCalledTimes(2);
    expect(() => command(service.adminSnapshot(session.id), "previous")).toThrow();
  });

  it("does not generate on an early End and handles missing configuration without blocking voting", async () => {
    let session = await setup();
    session = command(session, "open_first");
    const early = command(session, "end");
    expect(early.recapVisible).toBe(false);
    const copy = service.duplicateEndedSession(early.id, "another-session");
    session = service.startSession(copy.id, copy.controlRevision, randomUUID());
    session = command(finishQuestions(session), "next");
    expect(session.recap.status).toBe("failed");
    expect(session.aiRecapAvailable).toBe(false);
    expect(session.questions.every((question) => question.status === "closed")).toBe(true);
    expect(command(session, "end").status).toBe("ended");
  });

  it("marks interrupted generations retryable after restart and cancels on deletion", async () => {
    const generate = vi.fn<RecapGenerator>((_input, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    let session = await setup(generate);
    session = command(finishQuestions(session), "end");
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    await service.close();
    service = new VotingService(handle.database, generate, changed);
    expect(service.adminSnapshot(session.id).recap.status).toBe("failed");
    session = command(service.adminSnapshot(session.id), "retry_recap");
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    service.deleteSession(session.id, session.joinName);
    expect(generate.mock.calls[1]![1].aborted).toBe(true);
    await Promise.resolve();
    expect(() => service.adminSnapshot(session.id)).toThrow();
  });
});
