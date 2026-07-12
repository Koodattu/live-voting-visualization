import type { AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";
import { io as connect, type Socket } from "socket.io-client";
import { afterEach, expect, it } from "vitest";
import type {
  AdminSessionDetail,
  ClientToServerEvents,
  CommandResult,
  DisplaySnapshot,
  GuestCredentials,
  ParticipantSnapshot,
  PresenterCommand,
  ServerToClientEvents,
} from "../src/shared/contracts.js";
import { buildApplication, type Application } from "../src/server/app.js";
import { ADMIN_COOKIE_NAME } from "../src/server/auth/admin-auth.js";
import { testConfig } from "./helpers.js";

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

it("delivers synchronized updates within one second for 100 Participants", async () => {
  const config = await testConfig();
  const application = await buildApplication(config);
  const clients: TestSocket[] = [];
  try {
    await application.app.listen({ host: "127.0.0.1", port: 0 });
    const port = (application.app.server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;
    let session = application.service.createDraft({
      title: "Load Session",
      joinName: "load-session",
      language: "en",
      questions: [
        {
          type: "single_choice",
          prompt: "First Question",
          options: [{ label: "A" }, { label: "B" }],
        },
        {
          type: "single_choice",
          prompt: "Second Question",
          options: [{ label: "C" }, { label: "D" }],
        },
      ],
    });
    session = application.service.startSession(
      session.id,
      session.controlRevision,
      "load-start-0001",
    );

    const credentials = Array.from({ length: 100 }, () =>
      application.service.joinSession("load-session", undefined).credentials!,
    );
    const adminToken = application.auth.createSession().token;
    const presenter = connect(baseUrl, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
      extraHeaders: { Cookie: `${ADMIN_COOKIE_NAME}=${adminToken}` },
    }) as TestSocket;
    const display = connect(baseUrl, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
    }) as TestSocket;
    const participants = credentials.map(
      () =>
        connect(baseUrl, {
          forceNew: true,
          reconnection: false,
          transports: ["websocket"],
        }) as TestSocket,
    );
    clients.push(presenter, display, ...participants);
    await Promise.all(clients.map(waitForConnection));
    await Promise.all([
      subscribe(presenter, { joinName: "load-session", role: "admin" }),
      subscribe(display, { joinName: "load-session", role: "display" }),
      ...participants.map((participant, index) =>
        subscribe(participant, {
          joinName: "load-session",
          role: "participant",
          credentials: credentials[index],
        }),
      ),
    ]);

    const opened = await command(presenter, {
      requestId: "load-open-0001",
      action: "open_first",
      expectedControlRevision: session.controlRevision,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error(opened.error.message);
    session = opened.data;
    const firstQuestion = session.questions[0]!;

    const fullyCounted = waitForDisplay(
      display,
      (snapshot) => snapshot.currentQuestion?.result?.responseCount === 100,
    );
    const startedAt = performance.now();
    const responses = await Promise.all(
      participants.map((participant, index) =>
        submit(participant, {
          requestId: `load-vote-${String(index).padStart(4, "0")}`,
          questionId: firstQuestion.id,
          optionId: firstQuestion.options[index % 2]!.id,
        }),
      ),
    );
    expect(responses.every((response) => response.ok)).toBe(true);
    const displaySnapshot = await fullyCounted;
    const latency = performance.now() - startedAt;
    expect(latency).toBeLessThan(1_000);
    expect(displaySnapshot.currentQuestion?.result?.options.map((option) => option.count)).toEqual([
      50,
      50,
    ]);

    const changedCounts = waitForDisplay(
      display,
      (snapshot) =>
        snapshot.currentQuestion?.result?.options[0]?.count === 40 &&
        snapshot.currentQuestion.result.options[1]?.count === 60,
    );
    const changingParticipants = participants.filter((_, index) => index % 2 === 0).slice(0, 10);
    await Promise.all(
      changingParticipants.map((participant, index) =>
        submit(participant, {
          requestId: `load-change-${String(index).padStart(4, "0")}`,
          questionId: firstQuestion.id,
          optionId: firstQuestion.options[1]!.id,
        }),
      ),
    );
    await changedCounts;

    const closed = await command(presenter, {
      requestId: "load-close-first-0001",
      action: "close",
      expectedControlRevision: session.controlRevision,
    });
    expect(closed.ok).toBe(true);
    if (!closed.ok) throw new Error(closed.error.message);
    session = closed.data;
    expect(session.questions[0]?.participationDenominator).toBe(100);
    const next = await command(presenter, {
      requestId: "load-next-0001",
      action: "next",
      expectedControlRevision: session.controlRevision,
    });
    expect(next.ok).toBe(true);
    if (!next.ok) throw new Error(next.error.message);
    session = next.data;
    const closeSecond = await command(presenter, {
      requestId: "load-close-second-0001",
      action: "close",
      expectedControlRevision: session.controlRevision,
    });
    expect(closeSecond.ok).toBe(true);
    if (!closeSecond.ok) throw new Error(closeSecond.error.message);
    session = closeSecond.data;
    const previous = await command(presenter, {
      requestId: "load-previous-0001",
      action: "previous",
      expectedControlRevision: session.controlRevision,
    });
    expect(previous.ok).toBe(true);

    participants[0]!.disconnect();
    const reconnect = connect(baseUrl, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
    }) as TestSocket;
    clients.push(reconnect);
    await waitForConnection(reconnect);
    const restored = await subscribe(reconnect, {
      joinName: "load-session",
      role: "participant",
      credentials: credentials[0],
    });
    expect(restored.ok).toBe(true);
    if (restored.ok && restored.data.role === "participant") {
      expect(restored.data.currentQuestion?.position).toBe(0);
      expect(restored.data.ownResponse?.optionId).toBe(firstQuestion.options[1]!.id);
    }
  } finally {
    for (const client of clients) client.disconnect();
    await application.app.close();
  }
}, 30_000);

function waitForConnection(socket: TestSocket): Promise<void> {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Connection timed out.")), 5_000);
    socket.once("connect", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once("connect_error", reject);
  });
}

function subscribe(
  socket: TestSocket,
  request: Parameters<ClientToServerEvents["session:subscribe"]>[0],
) {
  return new Promise<
    CommandResult<ParticipantSnapshot | DisplaySnapshot | AdminSessionDetail>
  >((resolve) => socket.emit("session:subscribe", request, resolve));
}

function command(
  socket: TestSocket,
  presenterCommand: PresenterCommand,
) {
  return new Promise<CommandResult<AdminSessionDetail>>((resolve) =>
    socket.emit("presenter:command", presenterCommand, resolve),
  );
}

function submit(
  socket: TestSocket,
  response: Parameters<ClientToServerEvents["response:submit"]>[0],
) {
  return new Promise<CommandResult<ParticipantSnapshot>>((resolve) =>
    socket.emit("response:submit", response, resolve),
  );
}

function waitForDisplay(
  socket: TestSocket,
  predicate: (snapshot: DisplaySnapshot) => boolean,
): Promise<DisplaySnapshot> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Display update timed out.")), 2_000);
    const listener = (
      snapshot: ParticipantSnapshot | DisplaySnapshot | AdminSessionDetail,
    ) => {
      if (snapshot.role === "display" && predicate(snapshot)) {
        clearTimeout(timeout);
        socket.off("session:snapshot", listener);
        resolve(snapshot);
      }
    };
    socket.on("session:snapshot", listener);
  });
}
