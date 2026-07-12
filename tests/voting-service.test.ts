import { describe, expect, it } from "vitest";
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
        requestId: requestId("close-first"),
        action: "close",
        expectedControlRevision: session.controlRevision,
      });
      expect(session.questions[0]?.participationDenominator).toBe(2);
      expect(session.questions[0]?.result?.responseCount).toBe(1);
      expect(session.questions[0]?.result?.options[0]?.percentage).toBe(100);

      service.joinSession("event", undefined);
      expect(service.adminSnapshot(session.id).joinedCount).toBe(3);
      expect(service.adminSnapshot(session.id).questions[0]?.result?.participationDenominator).toBe(2);

      session = service.runPresenterCommand(session.id, {
        requestId: requestId("next-second"),
        action: "next",
        expectedControlRevision: session.controlRevision,
      });
      expect(session.questions[1]?.status).toBe("open");
      session = service.runPresenterCommand(session.id, {
        requestId: requestId("close-second"),
        action: "close",
        expectedControlRevision: session.controlRevision,
      });
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
        requestId: requestId("close-feedback"),
        action: "close",
        expectedControlRevision: session.controlRevision,
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
        questions: [
          {
            type: "single_choice",
            prompt: "Kysymys",
            options: [{ label: "Kyllä" }, { label: "Ei" }],
          },
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
        requestId: requestId("close"),
        action: "close",
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
});
