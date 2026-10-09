import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminSessionDetail, DraftSessionInput, PresenterAction } from "../src/shared/contracts.js";
import { openDatabase, type DatabaseHandle } from "../src/server/db/database.js";
import { VotingService } from "../src/server/services/voting-service.js";
import type { CommentDecision, CommentScreener } from "../src/server/services/comment-screening.js";
import { testConfig } from "./helpers.js";

const draft: DraftSessionInput = {
  title: "Team pulse", joinName: "team-pulse", language: "fi", lockQuestions: false, screenComments: true,
  questions: [
    { type: "single_choice", prompt: "Ready?", options: [{ label: "Yes" }, { label: "No" }] },
    { type: "feedback", prompt: "Any thoughts?", options: [] },
  ],
};
const allowed = { suitable: true, severeAbuseProbability: 0.01 };
const blocked = { suitable: false, severeAbuseProbability: 0.999 };

describe("optional free-word screening", () => {
  let handle: DatabaseHandle;
  let service: VotingService;
  async function setup(screen?: CommentScreener, overrides: Partial<DraftSessionInput> = {}) {
    handle = await openDatabase(await testConfig());
    service = new VotingService(handle.database, undefined, undefined, screen);
    return service.createDraft({ ...draft, ...overrides });
  }
  function command(session: AdminSessionDetail, action: PresenterAction) {
    return service.runPresenterCommand(session.id, { action, requestId: randomUUID(), expectedControlRevision: session.controlRevision });
  }
  function openFeedback(session: AdminSessionDetail) {
    session = service.startSession(session.id, session.controlRevision, randomUUID());
    session = command(session, "open_first");
    return command(session, "next");
  }
  function submit(session: AdminSessionDetail, guestId: string, content = "Vittu, Jerry, what a hot take!") {
    return { sessionId: session.id, guestId, payload: { requestId: randomUUID(), questionId: session.questions[1]!.id, content } };
  }
  afterEach(async () => {
    if (service) await service.close();
    if (handle) await handle.close();
  });

  it("defaults off, validates booleans, updates drafts, freezes live settings, and copies the toggle", async () => {
    let session = await setup(async () => allowed, { screenComments: undefined });
    expect(session.screenComments).toBe(false);
    expect(session.commentScreeningAvailable).toBe(true);
    expect(() => service.createDraft({ ...draft, screenComments: "yes" as unknown as boolean })).toThrow();
    session = service.updateDraft(session.id, draft, session.controlRevision);
    expect(session.screenComments).toBe(true);
    session = openFeedback(session);
    expect(() => service.updateDraft(session.id, { ...draft, screenComments: false }, session.controlRevision)).toThrow();
    session = command(session, "end");
    expect(service.duplicateEndedSession(session.id, "copied-session").screenComments).toBe(true);
  });

  it("requires configuration only when screening is enabled", async () => {
    let session = await setup();
    expect(session.commentScreeningAvailable).toBe(false);
    expect(() => service.startSession(session.id, session.controlRevision, randomUUID())).toThrow(/API key/);
    session = service.updateDraft(session.id, { ...draft, screenComments: false }, session.controlRevision);
    session = openFeedback(session);
    const guest = service.joinSession(session.joinName, undefined).credentials!;
    const request = submit(session, guest.guestId);
    expect((await service.submitScreenedResponse(session.id, guest.guestId, request.payload)).ownResponse?.content).toBe(request.payload.content);
  });

  it("bypasses the classifier for choices and rejects invalid comments before calling it", async () => {
    const screen = vi.fn<CommentScreener>(async () => allowed);
    let session = await setup(screen);
    session = service.startSession(session.id, session.controlRevision, randomUUID());
    const guest = service.joinSession(session.joinName, undefined).credentials!;
    session = command(session, "open_first");
    await service.submitScreenedResponse(session.id, guest.guestId, {
      requestId: randomUUID(), questionId: session.questions[0]!.id, optionId: session.questions[0]!.options[0]!.id,
    });
    session = command(session, "next");
    for (const content of [" ", "x".repeat(161)]) {
      await expect(service.submitScreenedResponse(session.id, guest.guestId, submit(session, guest.guestId, content).payload)).rejects.toMatchObject({ code: "invalid_comment" });
    }
    await expect(service.submitScreenedResponse(session.id, "unknown", submit(session, "unknown").payload)).rejects.toMatchObject({ code: "participant_required" });
    expect(screen).not.toHaveBeenCalled();
  });

  it("only saves approved text and preserves an accepted comment when an edit is rejected", async () => {
    const screen = vi.fn<CommentScreener>().mockResolvedValueOnce(allowed).mockResolvedValueOnce(blocked).mockResolvedValueOnce(allowed);
    const session = openFeedback(await setup(screen));
    const guest = service.joinSession(session.joinName, undefined).credentials!;
    const request = submit(session, guest.guestId, "  Vittu, Jerry!  ");
    expect(() => service.submitResponse(session.id, guest.guestId, request.payload)).toThrow(/must be checked/);
    const accepted = await service.submitScreenedResponse(session.id, guest.guestId, request.payload);
    expect(accepted.ownResponse?.content).toBe("Vittu, Jerry!");
    expect(accepted.screenComments).toBe(true);
    expect(screen).toHaveBeenCalledWith({ title: draft.title, question: "Any thoughts?", content: "Vittu, Jerry!" });
    await service.submitScreenedResponse(session.id, guest.guestId, request.payload);
    expect(screen).toHaveBeenCalledTimes(1);
    await expect(service.submitScreenedResponse(session.id, guest.guestId, submit(session, guest.guestId, "Rejected edit").payload)).rejects.toMatchObject({ code: "comment_not_suitable" });
    expect(service.adminSnapshot(session.id).questions[1]!.comments.map((c) => c.content)).toEqual(["Vittu, Jerry!"]);
    expect(handle.database.prepare("SELECT count(*) AS count FROM request_receipts WHERE actor_key = ?").get(guest.guestId)).toEqual({ count: 1 });
    await service.submitScreenedResponse(session.id, guest.guestId, submit(session, guest.guestId, "Rephrased comment").payload);
    expect(service.participantSnapshot(session.id, guest.guestId).ownResponse?.content).toBe("Rephrased comment");
  });

  it("does not save unchecked text after an API failure and permits a retry", async () => {
    const screen = vi.fn<CommentScreener>().mockRejectedValueOnce(new Error("private provider details")).mockResolvedValueOnce(allowed);
    const session = openFeedback(await setup(screen));
    const guest = service.joinSession(session.joinName, undefined).credentials!;
    const { payload } = submit(session, guest.guestId);
    await expect(service.submitScreenedResponse(session.id, guest.guestId, payload)).rejects.toMatchObject({ code: "comment_screening_unavailable" });
    expect(service.adminSnapshot(session.id).questions[1]!.comments).toEqual([]);
    await expect(service.submitScreenedResponse(session.id, guest.guestId, payload)).resolves.toMatchObject({ ownResponse: { content: payload.content } });
  });

  it("shares identical pending requests and rejects concurrent edits and request-ID reuse", async () => {
    let resolve!: (result: CommentDecision) => void;
    const screen = vi.fn<CommentScreener>(() => new Promise((done) => { resolve = done; }));
    const session = openFeedback(await setup(screen));
    const guest = service.joinSession(session.joinName, undefined).credentials!;
    const { payload } = submit(session, guest.guestId);
    const first = service.submitScreenedResponse(session.id, guest.guestId, payload);
    const retry = service.submitScreenedResponse(session.id, guest.guestId, payload);
    await expect(service.submitScreenedResponse(session.id, guest.guestId, { ...payload, content: "Different" })).rejects.toMatchObject({ code: "request_id_reused" });
    await expect(service.submitScreenedResponse(session.id, guest.guestId, { ...payload, requestId: randomUUID() })).rejects.toMatchObject({ code: "response_pending" });
    expect(service.adminSnapshot(session.id).questions[1]!.comments).toEqual([]);
    expect(screen).toHaveBeenCalledTimes(1);
    resolve(allowed);
    await Promise.all([first, retry]);
    expect(service.adminSnapshot(session.id).questions[1]!.comments).toHaveLength(1);
  });

  it.each(["previous", "end", "away-and-back"] as const)("discards a late approval after %s", async (action) => {
    let resolve!: (result: CommentDecision) => void;
    let session = openFeedback(await setup(() => new Promise((done) => { resolve = done; })));
    const guest = service.joinSession(session.joinName, undefined).credentials!;
    const pending = service.submitScreenedResponse(session.id, guest.guestId, submit(session, guest.guestId).payload);
    if (action === "away-and-back") {
      session = command(session, "previous");
      session = command(session, "next");
    } else session = command(session, action);
    resolve(allowed);
    await expect(pending).rejects.toMatchObject({ code: action === "end" ? "session_not_live" : action === "previous" ? "question_not_open" : "session_changed" });
    expect(service.adminSnapshot(session.id).questions[1]!.comments).toEqual([]);
  });
});
