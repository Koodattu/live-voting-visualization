import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AdminSessionDetail,
  ClientToServerEvents,
  CommandResult,
  DisplaySnapshot,
  GuestCredentials,
  ParticipantSnapshot,
  ServerToClientEvents,
} from "../src/shared/contracts.js";
import { buildApplication, type Application } from "../src/server/app.js";
import { testConfig } from "./helpers.js";

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

describe("HTTP and realtime integration", () => {
  let application: Application | undefined;
  const clients: TestSocket[] = [];

  afterEach(async () => {
    for (const client of clients) client.disconnect();
    clients.length = 0;
    if (application) await application.app.close();
    application = undefined;
  });

  it("protects admin routes and accepts an explicitly confirmed Draft deletion", async () => {
    const config = await testConfig({ cookieSecure: true });
    application = await buildApplication(config);

    const unauthorized = await application.app.inject({
      method: "GET",
      url: "/api/admin/sessions",
    });
    expect(unauthorized.statusCode).toBe(401);

    const login = await application.app.inject({
      method: "POST",
      url: "/api/admin/login",
      payload: { password: config.adminPassword },
    });
    expect(login.statusCode).toBe(200);
    expect(String(login.headers["set-cookie"])).toContain("Secure");
    const cookieHeader = String(login.headers["set-cookie"]).split(";")[0]!;

    const createdResponse = await application.app.inject({
      method: "POST",
      url: "/api/admin/sessions",
      headers: { cookie: cookieHeader },
      payload: {
        title: "Disposable Draft",
        joinName: "disposable",
        language: "en",
        questions: [],
      },
    });
    expect(createdResponse.statusCode).toBe(201);
    const draft = createdResponse.json<AdminSessionDetail>();

    const deleted = await application.app.inject({
      method: "DELETE",
      url: `/api/admin/sessions/${draft.id}`,
      headers: { cookie: cookieHeader },
      payload: { confirmation: true },
    });
    expect(deleted.statusCode).toBe(204);
  });

  it("disconnects an Admin socket when its HTTP session is logged out", async () => {
    const config = await testConfig();
    application = await buildApplication(config);
    await application.app.listen({ host: "127.0.0.1", port: 0 });
    const port = (application.app.server.address() as AddressInfo).port;

    const login = await application.app.inject({
      method: "POST",
      url: "/api/admin/login",
      payload: { password: config.adminPassword },
    });
    const cookieHeader = String(login.headers["set-cookie"]).split(";")[0]!;
    const created = await application.app.inject({
      method: "POST",
      url: "/api/admin/sessions",
      headers: { cookie: cookieHeader },
      payload: {
        title: "Logout Session",
        joinName: "logout-session",
        language: "en",
        questions: [
          {
            type: "single_choice",
            prompt: "Still connected?",
            options: [{ label: "Yes" }, { label: "No" }],
          },
        ],
      },
    });
    const draft = created.json<AdminSessionDetail>();
    const started = await application.app.inject({
      method: "POST",
      url: `/api/admin/sessions/${draft.id}/start`,
      headers: { cookie: cookieHeader },
      payload: {
        expectedControlRevision: draft.controlRevision,
        requestId: "logout-start-0001",
      },
    });
    expect(started.statusCode).toBe(200);

    const presenter = connect(`http://127.0.0.1:${port}`, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
      extraHeaders: { Cookie: cookieHeader },
    }) as TestSocket;
    clients.push(presenter);
    await waitForConnection(presenter);
    expect(
      (await subscribe(presenter, {
        joinName: "logout-session",
        role: "admin",
      })).ok,
    ).toBe(true);

    let privilegedSnapshots = 0;
    presenter.on("session:snapshot", (snapshot) => {
      if (snapshot.role === "admin") privilegedSnapshots += 1;
    });
    const logout = await application.app.inject({
      method: "POST",
      url: "/api/admin/logout",
      headers: { cookie: cookieHeader },
    });
    expect(logout.statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(presenter.connected).toBe(false);

    const join = await application.app.inject({
      method: "POST",
      url: "/api/public/sessions/logout-session/join",
      payload: {},
    });
    expect(join.statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(privilegedSnapshots).toBe(0);
  });

  it("synchronizes presenter, participant, and display while rejecting hostile events", async () => {
    const config = await testConfig();
    application = await buildApplication(config);
    await application.app.listen({ host: "127.0.0.1", port: 0 });
    const port = (application.app.server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const login = await application.app.inject({
      method: "POST",
      url: "/api/admin/login",
      payload: { password: config.adminPassword },
    });
    expect(login.statusCode).toBe(200);
    const cookieHeader = String(login.headers["set-cookie"]).split(";")[0]!;
    expect(String(login.headers["set-cookie"])).toContain("HttpOnly");
    expect(String(login.headers["set-cookie"])).toContain("SameSite=Strict");

    const createdResponse = await application.app.inject({
      method: "POST",
      url: "/api/admin/sessions",
      headers: { cookie: cookieHeader },
      payload: {
        title: "Integration Session",
        joinName: "integration",
        language: "en",
        questions: [
          {
            type: "single_choice",
            prompt: "Ready?",
            options: [{ label: "Yes" }, { label: "No" }],
          },
        ],
      },
    });
    expect(createdResponse.statusCode).toBe(201);
    const draft = createdResponse.json<AdminSessionDetail>();
    const startedResponse = await application.app.inject({
      method: "POST",
      url: `/api/admin/sessions/${draft.id}/start`,
      headers: { cookie: cookieHeader },
      payload: {
        expectedControlRevision: draft.controlRevision,
        requestId: "integration-start-0001",
      },
    });
    expect(startedResponse.statusCode).toBe(200);
    const live = startedResponse.json<AdminSessionDetail>();

    const joinResponse = await application.app.inject({
      method: "POST",
      url: "/api/public/sessions/integration/join",
      payload: {},
    });
    expect(joinResponse.statusCode).toBe(200);
    const joined = joinResponse.json<{
      credentials: GuestCredentials;
      snapshot: ParticipantSnapshot;
    }>();

    const participant = connect(baseUrl, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
    }) as TestSocket;
    const display = connect(baseUrl, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
    }) as TestSocket;
    const presenter = connect(baseUrl, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
      extraHeaders: { Cookie: cookieHeader },
    }) as TestSocket;
    clients.push(participant, display, presenter);
    await Promise.all(clients.map(waitForConnection));

    const [participantSubscription, displaySubscription, adminSubscription] =
      await Promise.all([
        subscribe(participant, {
          joinName: "integration",
          role: "participant",
          credentials: joined.credentials,
        }),
        subscribe(display, { joinName: "integration", role: "display" }),
        subscribe(presenter, { joinName: "integration", role: "admin" }),
      ]);
    expect(participantSubscription.ok).toBe(true);
    expect(displaySubscription.ok).toBe(true);
    expect(adminSubscription.ok).toBe(true);

    const extraDisplays = Array.from(
      { length: 20 },
      () =>
        connect(baseUrl, {
          forceNew: true,
          reconnection: false,
          transports: ["websocket"],
        }) as TestSocket,
    );
    clients.push(...extraDisplays);
    await Promise.all(extraDisplays.map(waitForConnection));
    const displayCapacityResults = await Promise.all(
      extraDisplays.map((extraDisplay) =>
        subscribe(extraDisplay, { joinName: "integration", role: "display" }),
      ),
    );
    expect(displayCapacityResults.filter((result) => result.ok)).toHaveLength(19);
    expect(
      displayCapacityResults.filter(
        (result) =>
          !result.ok && result.error.code === "view_capacity_reached",
      ),
    ).toHaveLength(1);
    for (const extraDisplay of extraDisplays) extraDisplay.disconnect();

    const opened = await presenterCommand(presenter, {
      requestId: "integration-open-0001",
      action: "open_first",
      expectedControlRevision: live.controlRevision,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error(opened.error.message);
    const question = opened.data.questions[0]!;

    const displayUpdate = waitForDisplayResponses(display, 1);
    const vote = await submitResponse(participant, {
      requestId: "integration-vote-0001",
      questionId: question.id,
      optionId: question.options[0]!.id,
    });
    expect(vote.ok).toBe(true);
    const updatedDisplay = await displayUpdate;
    expect(updatedDisplay.currentQuestion?.result?.responseCount).toBe(1);

    const rawSocket = participant as unknown as {
      emit: (event: string, ...values: unknown[]) => void;
    };
    rawSocket.emit("session:snapshot");
    rawSocket.emit("response:submit", { nonsense: true });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const health = await application.app.inject({
      method: "GET",
      url: "/api/health",
    });
    expect(health.statusCode).toBe(200);
    expect(health.json<{ status: string }>().status).toBe("ok");

    const snapshotFlood: Array<
      CommandResult<ParticipantSnapshot | DisplaySnapshot | AdminSessionDetail>
    > = [];
    for (let index = 0; index < 65; index += 1) {
      snapshotFlood.push(await requestSnapshot(participant));
    }
    expect(
      snapshotFlood.some(
        (result) => !result.ok && result.error.code === "rate_limited",
      ),
    ).toBe(true);

    const malformedPresenter = await new Promise<CommandResult<AdminSessionDetail>>(
      (resolveResult) => {
        (presenter as unknown as { emit: (...values: unknown[]) => void }).emit(
          "presenter:command",
          {
            requestId: "malformed-presenter-0001",
            action: "launch_missiles",
            expectedControlRevision: opened.data.controlRevision,
          },
          resolveResult,
        );
      },
    );
    expect(malformedPresenter.ok).toBe(false);

    const participantClosed = waitForParticipantStatus(participant, "closed");
    const closed = await presenterCommand(presenter, {
      requestId: "integration-close-0001",
      action: "close",
      expectedControlRevision: opened.data.controlRevision,
    });
    expect(closed.ok).toBe(true);
    const closedParticipant = await participantClosed;
    expect(closedParticipant.currentQuestion?.status).toBe("closed");
    expect(closedParticipant.currentQuestion).not.toHaveProperty("result");
  });
});

function waitForConnection(socket: TestSocket): Promise<void> {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Socket connection timed out.")), 2_000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function subscribe(
  socket: TestSocket,
  request: Parameters<ClientToServerEvents["session:subscribe"]>[0],
): Promise<
  CommandResult<ParticipantSnapshot | DisplaySnapshot | AdminSessionDetail>
> {
  return new Promise((resolve) => socket.emit("session:subscribe", request, resolve));
}

function presenterCommand(
  socket: TestSocket,
  command: Parameters<ClientToServerEvents["presenter:command"]>[0],
): Promise<CommandResult<AdminSessionDetail>> {
  return new Promise((resolve) => socket.emit("presenter:command", command, resolve));
}

function submitResponse(
  socket: TestSocket,
  submission: Parameters<ClientToServerEvents["response:submit"]>[0],
): Promise<CommandResult<ParticipantSnapshot>> {
  return new Promise((resolve) => socket.emit("response:submit", submission, resolve));
}

function requestSnapshot(
  socket: TestSocket,
): Promise<
  CommandResult<ParticipantSnapshot | DisplaySnapshot | AdminSessionDetail>
> {
  return new Promise((resolve) => socket.emit("session:snapshot", resolve));
}

function waitForDisplayResponses(
  socket: TestSocket,
  count: number,
): Promise<DisplaySnapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Display update timed out.")), 1_000);
    const listener = (
      snapshot: ParticipantSnapshot | DisplaySnapshot | AdminSessionDetail,
    ) => {
      if (
        snapshot.role === "display" &&
        snapshot.currentQuestion?.result?.responseCount === count
      ) {
        clearTimeout(timer);
        socket.off("session:snapshot", listener);
        resolve(snapshot);
      }
    };
    socket.on("session:snapshot", listener);
  });
}

function waitForParticipantStatus(
  socket: TestSocket,
  status: "open" | "closed" | "unshown",
): Promise<ParticipantSnapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Participant update timed out.")),
      1_000,
    );
    const listener = (
      snapshot: ParticipantSnapshot | DisplaySnapshot | AdminSessionDetail,
    ) => {
      if (
        snapshot.role === "participant" &&
        snapshot.currentQuestion?.status === status
      ) {
        clearTimeout(timer);
        socket.off("session:snapshot", listener);
        resolve(snapshot);
      }
    };
    socket.on("session:snapshot", listener);
  });
}
