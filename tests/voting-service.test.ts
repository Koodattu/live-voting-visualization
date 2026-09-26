import { describe, expect, it } from "vitest";
import type { DraftSessionInput, PresenterAction } from "../src/shared/contracts.js";
import { AdminAuth } from "../src/server/auth/admin-auth.js";
import { openDatabase } from "../src/server/db/database.js";
import { AppError } from "../src/server/errors.js";
import { VotingService } from "../src/server/services/voting-service.js";
import { testConfig } from "./helpers.js";

async function createService() {
  const config = await testConfig();
  const handle = await openDatabase(config);
  return {
    close: handle.close,
    database: handle.database,
    service: new VotingService(handle.database),
  };
}

function requestId(label: string): string {
  return `request-${label}-0001`;
}

describe("VotingService", () => {
  it("runs the complete presenter-led flow and preserves final results", async () => {
    const { service, database, close } = await createService();
    try {
      let session = service.createDraft({
        title: "Formula-safe event",
        joinName: "event",
        language: "en",
        lockQuestions: true,
        questions: [
          {
            type: "single_choice",
            prompt: "=Choose now",
            options: [{ label: "+Yes" }, { label: "No" }],
          },
          {
            type: "single_choice",
            prompt: "What fits best?",
            options: [{ label: "First" }, { label: "Second" }],
          },
          { type: "feedback", prompt: "Final Comment", options: [] },
        ],
      });
      session = service.startSession(
        session.id,
        session.controlRevision,
        requestId("start"),
      );
      const duplicateStart = service.startSession(
        session.id,
        0,
        requestId("start"),
      );
      expect(duplicateStart.controlRevision).toBe(session.controlRevision);

      const firstGuest = service.joinSession("event", undefined);
      const restoredGuest = service.joinSession("event", firstGuest.credentials ?? undefined);
      const secondGuest = service.joinSession("event", undefined);
      expect(restoredGuest.issued).toBe(false);
      expect(service.adminSnapshot(session.id).joinedCount).toBe(2);

      session = service.runPresenterCommand(session.id, {
        requestId: requestId("open-first"),
        action: "open_first",
        expectedControlRevision: session.controlRevision,
      });
      const firstQuestion = session.questions[0]!;
      const firstOption = firstQuestion.options[0]!;
      const secondOption = firstQuestion.options[1]!;
      const firstCredentials = firstGuest.credentials!;
      const beforeResponseVersion = session.stateVersion;
      const resultPlan = database
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT options.id, count(votes.guest_id)
           FROM options
           LEFT JOIN votes
             ON votes.question_id = options.question_id
            AND votes.option_id = options.id
           WHERE options.question_id = ?
           GROUP BY options.id`,
        )
        .all(firstQuestion.id) as Array<{ detail: string }>;
      expect(
        resultPlan.some((step) =>
          step.detail.includes("votes_by_question_option"),
        ),
      ).toBe(true);

      let participant = service.submitResponse(
        session.id,
        firstCredentials.guestId,
        {
          requestId: requestId("vote-one"),
          questionId: firstQuestion.id,
          optionId: firstOption.id,
        },
      );
      const versionAfterResponse = participant.stateVersion;
      participant = service.submitResponse(
        session.id,
        firstCredentials.guestId,
        {
          requestId: requestId("vote-one"),
          questionId: firstQuestion.id,
          optionId: firstOption.id,
        },
      );
      expect(participant.stateVersion).toBe(versionAfterResponse);
      expect(versionAfterResponse).toBeGreaterThan(beforeResponseVersion);
      expect(participant.ownResponse?.optionId).toBe(firstOption.id);
      expect(participant.currentQuestion).not.toHaveProperty("result");

      service.submitResponse(session.id, firstCredentials.guestId, {
        requestId: requestId("vote-two"),
        questionId: firstQuestion.id,
        optionId: secondOption.id,
      });
      service.submitResponse(session.id, firstCredentials.guestId, {
        requestId: requestId("vote-three"),
        questionId: firstQuestion.id,
        optionId: firstOption.id,
      });

      session = service.runPresenterCommand(session.id, {
        requestId: requestId("next-second"),
        action: "next",
        expectedControlRevision: session.controlRevision,
      });
      expect(session.questions[0]?.participationDenominator).toBe(2);
      expect(session.questions[0]?.result?.responseCount).toBe(1);
      expect(session.questions[0]?.result?.options[0]?.percentage).toBe(100);

      service.joinSession("event", undefined);
      expect(service.adminSnapshot(session.id).joinedCount).toBe(3);
      expect(service.adminSnapshot(session.id).questions[0]?.result?.participationDenominator).toBe(2);

      expect(session.questions[1]?.status).toBe("open");
      session = service.runPresenterCommand(session.id, {
        requestId: requestId("previous-first"),
        action: "previous",
        expectedControlRevision: session.controlRevision,
      });
      expect(session.presentedPosition).toBe(0);
      expect(service.participantSnapshot(session.id, firstCredentials.guestId).results).toEqual([]);
      session = service.runPresenterCommand(session.id, {
        requestId: requestId("next-revisit"),
        action: "next",
        expectedControlRevision: session.controlRevision,
      });
      expect(session.presentedPosition).toBe(1);
      expect(session.questions[1]?.status).toBe("closed");
      session = service.runPresenterCommand(session.id, {
        requestId: requestId("next-feedback"),
        action: "next",
        expectedControlRevision: session.controlRevision,
      });
      const feedback = session.questions[2]!;
      service.submitResponse(session.id, firstCredentials.guestId, {
        requestId: requestId("comment"),
        questionId: feedback.id,
        content: "@great experience",
      });
      session = service.runPresenterCommand(session.id, {
        requestId: requestId("hide-wall"),
        action: "set_comment_wall",
        expectedControlRevision: session.controlRevision,
        value: false,
      });
      session = service.runPresenterCommand(session.id, {
        requestId: requestId("end"),
        action: "end",
        expectedControlRevision: session.controlRevision,
      });

      const endedParticipant = service.participantSnapshot(
        session.id,
        firstCredentials.guestId,
      );
      expect(endedParticipant.status).toBe("ended");
      expect(endedParticipant.currentQuestion).toBeNull();
      expect(endedParticipant.results).toHaveLength(3);
      expect(endedParticipant.results[2]?.commentsVisible).toBe(false);
      expect(endedParticipant.results[2]?.comments).toEqual([]);
      expect(service.displaySnapshot(session.id).currentQuestion?.comments).toEqual([]);
      expect(service.adminSnapshot(session.id).questions[2]?.comments).toHaveLength(1);
      expect(service.listLiveSessions()).toEqual([]);

      const exported = service.exportCsv(session.id);
      expect(exported.csv).toContain("\"'=Choose now\"");
      expect(exported.csv).toContain("\"'+Yes\"");
      expect(exported.csv).toContain("\"'@great experience\"");
      expect(exported.csv).not.toContain(firstCredentials.secret);

      const copy = service.duplicateEndedSession(session.id, "next-event");
      expect(copy.status).toBe("draft");
      expect(copy.questions).toHaveLength(3);
      expect(copy.joinedCount).toBe(0);

      expect(() => service.deleteSession(session.id, "wrong")).toThrow(AppError);
      service.deleteSession(session.id, "event");
      const reused = service.createDraft({
        title: "Reused name",
        joinName: "event",
        language: "en",
        lockQuestions: true,
        questions: [
          {
            type: "single_choice",
            prompt: "New Question",
            options: [{ label: "A" }, { label: "B" }],
          },
        ],
      });
      const reusedLive = service.startSession(
        reused.id,
        reused.controlRevision,
        requestId("reused-start"),
      );
      const newIdentity = service.joinSession("event", firstCredentials);
      expect(newIdentity.issued).toBe(true);
      expect(newIdentity.credentials?.sessionId).toBe(reusedLive.id);
      expect(newIdentity.credentials?.guestId).not.toBe(firstCredentials.guestId);
    } finally {
      await close();
    }
  });

  it("rejects stale controls, writes after close, and deletion while live", async () => {
    const { service, close } = await createService();
    try {
      let session = service.createDraft({
        title: "Concurrency",
        joinName: "concurrency",
        language: "fi",
        lockQuestions: true,
        questions: [
          {
            type: "single_choice",
            prompt: "Kysymys",
            options: [{ label: "Kyllä" }, { label: "Ei" }],
          },
          { type: "feedback", prompt: "Palaute", options: [] },
        ],
      });
      session = service.startSession(
        session.id,
        session.controlRevision,
        requestId("concurrency-start"),
      );
      expect(() => service.deleteSession(session.id, true)).toThrow(
        "End the Voting Session before deleting it.",
      );
      const credentials = service.joinSession("concurrency", undefined).credentials!;
      const revision = session.controlRevision;
      session = service.runPresenterCommand(session.id, {
        requestId: requestId("winner"),
        action: "open_first",
        expectedControlRevision: revision,
      });
      expect(() =>
        service.runPresenterCommand(session.id, {
          requestId: requestId("stale"),
          action: "toggle_theme",
          expectedControlRevision: revision,
        }),
      ).toThrow("Presenter state changed in another browser");
      session = service.runPresenterCommand(session.id, {
        requestId: requestId("next"),
        action: "next",
        expectedControlRevision: session.controlRevision,
      });
      expect(() =>
        service.submitResponse(session.id, credentials.guestId, {
          requestId: requestId("late-vote"),
          questionId: session.questions[0]!.id,
          optionId: session.questions[0]!.options[0]!.id,
        }),
      ).toThrow("no longer accepting responses");
    } finally {
      await close();
    }
  });

  it("invalidates Admin Sessions when the configured password changes", async () => {
    const { database, close } = await createService();
    try {
      const original = new AdminAuth(database, "first-password");
      const token = original.createSession().token;
      expect(original.isAuthenticated(token)).toBe(true);
      expect(new AdminAuth(database, "first-password").isAuthenticated(token)).toBe(true);
      expect(new AdminAuth(database, "second-password").isAuthenticated(token)).toBe(false);
      original.invalidate(token);
      expect(original.isAuthenticated(token)).toBe(false);
    } finally {
      await close();
    }
  });

  it.each([true, false])("preserves responses and applies the locking policy on every revisit (lockQuestions=%s)", async (lockQuestions) => {
    const { service, database, close } = await createService();
    try {
      const input: DraftSessionInput = {
        title: "Revisits",
        joinName: "revisits",
        language: "en",
        lockQuestions: !lockQuestions,
        questions: [
          { type: "single_choice", prompt: "Choose", options: [{ label: "A" }, { label: "B" }] },
          { type: "feedback", prompt: "Comment", options: [] },
        ],
      };
      let session = service.createDraft(input);
      session = service.updateDraft(session.id, { ...input, lockQuestions }, session.controlRevision);
      expect(service.adminSnapshot(session.id).lockQuestions).toBe(lockQuestions);
      session = service.startSession(session.id, session.controlRevision, requestId("start-revisits"));
      expect(() => service.updateDraft(session.id, input, session.controlRevision)).toThrow("cannot be changed");
      const guest = service.joinSession("revisits", undefined).credentials!;
      let sequence = 0;
      const command = (action: PresenterAction) => {
        const command = { action, requestId: requestId(`revisit-${sequence++}`), expectedControlRevision: session.controlRevision };
        session = service.runPresenterCommand(session.id, command);
        // Retrying navigation must not advance, close, or reopen a second time.
        expect(service.runPresenterCommand(session.id, command)).toEqual(session);
      };
      command("open_first");
      const choice = session.questions[0]!;
      const feedback = session.questions[1]!;
      const vote = (optionIndex: number) => service.submitResponse(session.id, guest.guestId, {
        requestId: requestId(`vote-${sequence++}`),
        questionId: choice.id,
        optionId: choice.options[optionIndex]!.id,
      });
      const comment = (content: string) => service.submitResponse(session.id, guest.guestId, {
        requestId: requestId(`comment-${sequence++}`), questionId: feedback.id, content,
      });
      vote(0);
      const originalVote = service.participantSnapshot(session.id, guest.guestId).ownResponse!;
      const originalOpenTime = session.questions[0]!.openedAt;
      expect(() => command("previous")).toThrow("no previous Question");
      expect(service.adminSnapshot(session.id).questions[0]!.status).toBe("open");
      command("next");
      expect(session.questions[0]!.participationDenominator).toBe(1);
      expect(service.displaySnapshot(session.id).previousQuestion?.result?.responseCount).toBe(1);
      expect(() => vote(1)).toThrow("no longer accepting responses");
      comment("Original comment");
      const originalComment = service.participantSnapshot(session.id, guest.guestId).ownResponse!;
      service.joinSession("revisits", undefined);
      expect(() => command("next")).toThrow("no next Question");
      expect(service.adminSnapshot(session.id).questions[1]!.status).toBe("open");
      command("previous");
      expect(session.questions[0]!.status).toBe(lockQuestions ? "closed" : "open");
      expect(session.questions[0]!.openedAt).toBe(originalOpenTime);
      expect(service.joinSession("revisits", guest).snapshot.ownResponse).toEqual(originalVote);
      expect(() => comment("Offscreen comment")).toThrow("no longer accepting responses");
      if (lockQuestions) {
        expect(() => vote(1)).toThrow("no longer accepting responses");
        expect(session.questions[0]!.result!.participationDenominator).toBe(1);
      } else {
        expect(session.questions[0]!.closedAt).toBeNull();
        expect(session.questions[0]!.result!.participationDenominator).toBe(2);
        expect(vote(1).ownResponse?.createdAt).toBe(originalVote.createdAt);
        expect(service.adminSnapshot(session.id).questions[0]!.result!.options.map((option) => option.count)).toEqual([0, 1]);
      }
      command("next");
      expect(service.participantSnapshot(session.id, guest.guestId).ownResponse).toEqual(originalComment);
      if (lockQuestions) expect(() => comment("Edited comment")).toThrow("no longer accepting responses");
      else expect(comment("Edited comment").ownResponse?.createdAt).toBe(originalComment.createdAt);
      expect(database.prepare("SELECT count(*) AS count FROM questions WHERE session_id = ? AND status = 'open'").get(session.id)).toEqual({ count: lockQuestions ? 0 : 1 });
      command("end");
      const results = service.participantSnapshot(session.id, guest.guestId).results;
      expect(results).toHaveLength(2);
      expect(results[1]!.comments[0]!.content).toBe(lockQuestions ? "Original comment" : "Edited comment");
      expect(session.questions.every((question) => question.status === "closed")).toBe(true);
      expect(() => vote(0)).toThrow("no longer accepting responses");
      expect(() => comment("Too late")).toThrow("no longer accepting responses");
      const copy = service.duplicateEndedSession(session.id, "revisit-copy");
      expect(copy.lockQuestions).toBe(lockQuestions);
      expect(copy.questions.every((question) => question.status === "unshown")).toBe(true);
    } finally {
      await close();
    }
  });

  it.each([true, false])("ends from the Lobby or an Open Question without presenting later Questions (lockQuestions=%s)", async (lockQuestions) => {
    const { service, close } = await createService();
    try {
      for (const openFirst of [true, false]) {
        let session = service.createDraft({
          title: "End early", joinName: `end-early-${openFirst}`, language: "en", lockQuestions,
          questions: [
            { type: "single_choice", prompt: "First", options: [{ label: "A" }, { label: "B" }] },
            { type: "feedback", prompt: "Unshown", options: [] },
          ],
        });
        session = service.startSession(session.id, session.controlRevision, requestId("early-start"));
        if (openFirst) session = service.runPresenterCommand(session.id, {
          action: "open_first", requestId: requestId("early-open"), expectedControlRevision: session.controlRevision,
        });
        session = service.runPresenterCommand(session.id, {
          action: "end", requestId: requestId("early-end"), expectedControlRevision: session.controlRevision,
        });
        expect(session.status).toBe("ended");
        expect(session.questions[1]!.status).toBe("unshown");
        expect(service.participantSnapshot(session.id, null).results).toHaveLength(openFirst ? 1 : 0);
        expect(service.displaySnapshot(session.id).currentQuestion?.status ?? null).toBe(openFirst ? "closed" : null);
      }
    } finally {
      await close();
    }
  });
});
