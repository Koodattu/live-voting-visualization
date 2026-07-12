import { BlockList, isIP } from "node:net";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { Server as SocketServer, type Socket } from "socket.io";
import type {
  AdminSessionDetail,
  ClientToServerEvents,
  CommandResult,
  DisplaySnapshot,
  DraftSessionInput,
  GuestCredentials,
  ParticipantSnapshot,
  PresenterCommand,
  ResponseSubmission,
  ServerToClientEvents,
  SocketData,
  SubscribeRequest,
} from "../shared/contracts.js";
import {
  ADMIN_COOKIE_NAME,
  AdminAuth,
  readCookie,
} from "./auth/admin-auth.js";
import type { AppConfig } from "./config.js";
import { openDatabase } from "./db/database.js";
import { AppError, asAppError } from "./errors.js";
import { WindowRateLimiter } from "./realtime/rate-limiter.js";
import { VotingService } from "./services/voting-service.js";

type TypedSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

const MAX_ADMIN_SOCKETS_PER_SESSION = 10;
const MAX_DISPLAY_SOCKETS_PER_SESSION = 20;
const MAX_PARTICIPANT_SOCKETS_PER_GUEST = 3;
const MAX_PARTICIPANT_SOCKETS_PER_SESSION = 750;

function normalizeIpAddress(address: string): string {
  if (address.startsWith("::ffff:") && isIP(address.slice(7)) === 4) {
    return address.slice(7);
  }
  return address;
}

function createClientAddressResolver(
  trustProxy: AppConfig["trustProxy"],
): (remoteAddress: string, forwardedFor: string | string[] | undefined) => string {
  if (!trustProxy) {
    return (remoteAddress) => normalizeIpAddress(remoteAddress || "unknown");
  }

  const [proxyAddress, prefixText] = trustProxy.split("/");
  const version = isIP(proxyAddress ?? "");
  const maximumPrefix = version === 4 ? 32 : 128;
  const prefix = prefixText === undefined ? maximumPrefix : Number(prefixText);
  if (
    version === 0 ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > maximumPrefix
  ) {
    throw new Error("TRUST_PROXY must be an IP address or CIDR range.");
  }

  const trusted = new BlockList();
  trusted.addSubnet(
    proxyAddress!,
    prefix,
    version === 4 ? "ipv4" : "ipv6",
  );
  const isTrusted = (address: string): boolean => {
    const normalized = normalizeIpAddress(address);
    const addressVersion = isIP(normalized);
    return (
      addressVersion !== 0 &&
      trusted.check(normalized, addressVersion === 4 ? "ipv4" : "ipv6")
    );
  };

  return (remoteAddress, forwardedFor) => {
    const remote = normalizeIpAddress(remoteAddress || "unknown");
    if (!isTrusted(remote) || forwardedFor === undefined) return remote;
    const chain = (Array.isArray(forwardedFor) ? forwardedFor : [forwardedFor])
      .flatMap((value) => value.split(","))
      .map((value) => normalizeIpAddress(value.trim()))
      .filter((value) => value.length > 0);
    let clientAddress = remote;
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const candidate = chain[index]!;
      if (isIP(candidate) === 0) return remote;
      clientAddress = candidate;
      if (!isTrusted(candidate)) break;
    }
    return clientAddress;
  };
}

const draftSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "joinName", "language", "questions"],
  properties: {
    title: { type: "string", maxLength: 100 },
    joinName: { type: "string", maxLength: 24 },
    language: { type: "string", enum: ["en", "fi"] },
    questions: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "prompt", "options"],
        properties: {
          type: { type: "string", enum: ["single_choice", "feedback"] },
          prompt: { type: "string", maxLength: 240 },
          options: {
            type: "array",
            maxItems: 5,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label"],
              properties: {
                label: { type: "string", maxLength: 100 },
              },
            },
          },
        },
      },
    },
  },
} as const;

function success<T>(data: T): CommandResult<T> {
  return { ok: true, data };
}

function failure(error: unknown): CommandResult<never> {
  const appError = asAppError(error);
  return {
    ok: false,
    error: { code: appError.code, message: appError.message },
  };
}

function sendAcknowledgement<T>(
  acknowledge: unknown,
  result: CommandResult<T>,
): void {
  if (typeof acknowledge !== "function") return;
  try {
    (acknowledge as (value: CommandResult<T>) => void)(result);
  } catch {
    // A remote acknowledgement is best-effort; committed state remains authoritative.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGuestCredentials(value: unknown): value is GuestCredentials {
  return (
    isRecord(value) &&
    typeof value.sessionId === "string" &&
    typeof value.guestId === "string" &&
    typeof value.secret === "string"
  );
}

function isSubscribeRequest(value: unknown): value is SubscribeRequest {
  return (
    isRecord(value) &&
    typeof value.joinName === "string" &&
    ["participant", "display", "admin"].includes(String(value.role)) &&
    (value.credentials === undefined || isGuestCredentials(value.credentials))
  );
}

function isResponseSubmission(value: unknown): value is ResponseSubmission {
  return (
    isRecord(value) &&
    typeof value.requestId === "string" &&
    typeof value.questionId === "string" &&
    (value.optionId === undefined || typeof value.optionId === "string") &&
    (value.content === undefined || typeof value.content === "string")
  );
}

function isPresenterCommand(value: unknown): value is PresenterCommand {
  return (
    isRecord(value) &&
    typeof value.requestId === "string" &&
    [
      "open_first",
      "close",
      "previous",
      "next",
      "end",
      "toggle_theme",
      "set_comment_wall",
    ].includes(String(value.action)) &&
    Number.isInteger(value.expectedControlRevision) &&
    Number(value.expectedControlRevision) >= 0 &&
    (value.value === undefined || typeof value.value === "boolean")
  );
}

function participantRoom(sessionId: string): string {
  return `session:${sessionId}:participants`;
}

function displayRoom(sessionId: string): string {
  return `session:${sessionId}:displays`;
}

function adminRoom(sessionId: string): string {
  return `session:${sessionId}:admins`;
}

function guestRoom(sessionId: string, guestId: string): string {
  return `session:${sessionId}:guest:${guestId}`;
}

export interface Application {
  app: FastifyInstance;
  auth: AdminAuth;
  io: SocketServer<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >;
  service: VotingService;
}

export async function buildApplication(config: AppConfig): Promise<Application> {
  const resolveClientAddress = createClientAddressResolver(config.trustProxy);
  const socketConnectionLimiter = new WindowRateLimiter(1_500, 60_000);
  const socketEventAddressLimiter = new WindowRateLimiter(1_500, 60_000);
  const app = Fastify({
    bodyLimit: 256 * 1_024,
    logger:
      config.logLevel === "silent"
        ? false
        : {
            level: config.logLevel,
            redact: ["req.headers.cookie", "res.headers.set-cookie"],
          },
    trustProxy: config.trustProxy,
  });
  const databaseHandle = await openDatabase(config, (error) => {
    app.log.error({ error }, "Daily SQLite backup failed");
  });
  const service = new VotingService(databaseHandle.database);
  const auth = new AdminAuth(databaseHandle.database, config.adminPassword);
  const developmentOrigins = new Set([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);
  const io = new SocketServer<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >(app.server, {
    serveClient: false,
    transports: ["websocket", "polling"],
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      const originAllowed =
        origin === undefined ||
        origin === config.publicOrigin ||
        (!config.serveClient && developmentOrigins.has(origin));
      const clientAddress = resolveClientAddress(
        request.socket.remoteAddress ?? "unknown",
        request.headers["x-forwarded-for"],
      );
      callback(
        null,
        originAllowed && socketConnectionLimiter.accept(clientAddress),
      );
    },
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((error, _request, reply) => {
    const appError = asAppError(error);
    if (
      !(error instanceof AppError) &&
      typeof error === "object" &&
      error !== null &&
      "validation" in error
    ) {
      reply.status(400).send({
        error: { code: "invalid_request", message: "Check the submitted values." },
      });
      return;
    }
    reply.status(appError.statusCode).send({
      error: { code: appError.code, message: appError.message },
    });
  });

  const requireAdmin = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    if (!auth.isAuthenticated(request.cookies[ADMIN_COOKIE_NAME])) {
      await reply.status(401).send({
        error: { code: "admin_required", message: "Enter the presenter password." },
      });
    }
  };

  const broadcastSnapshots = async (
    sessionId: string,
    includeParticipants: boolean,
    guestIds: Iterable<string> = [],
  ): Promise<void> => {
    try {
      io.to(displayRoom(sessionId)).emit(
        "session:snapshot",
        service.displaySnapshot(sessionId),
      );
      const adminSockets = await io.in(adminRoom(sessionId)).fetchSockets();
      let adminSnapshot: AdminSessionDetail | undefined;
      for (const adminSocket of adminSockets) {
        const token = readCookie(
          adminSocket.handshake.headers.cookie,
          ADMIN_COOKIE_NAME,
        );
        if (!auth.isAuthenticated(token)) {
          adminSocket.disconnect(true);
          continue;
        }
        adminSnapshot ??= service.adminSnapshot(sessionId);
        adminSocket.emit("session:snapshot", adminSnapshot);
      }
      for (const guestId of guestIds) {
        io.to(guestRoom(sessionId, guestId)).emit(
          "session:snapshot",
          service.participantSnapshot(sessionId, guestId),
        );
      }
      if (includeParticipants) {
        const sockets = await io.in(participantRoom(sessionId)).fetchSockets();
        for (const participantSocket of sockets) {
          const participantGuestId = participantSocket.data.guestId ?? null;
          participantSocket.emit(
            "session:snapshot",
            service.participantSnapshot(sessionId, participantGuestId),
          );
        }
      }
    } catch (error) {
      if (!(error instanceof AppError && error.code === "session_not_found")) {
        app.log.error(error);
      }
    }
  };

  const pendingResponseBroadcasts = new Map<
    string,
    { guestIds: Set<string>; timer: ReturnType<typeof setTimeout> }
  >();
  const scheduleResponseBroadcast = (sessionId: string, guestId: string): void => {
    const pending = pendingResponseBroadcasts.get(sessionId);
    if (pending) {
      pending.guestIds.add(guestId);
      return;
    }
    const guestIds = new Set([guestId]);
    const timer = setTimeout(() => {
      pendingResponseBroadcasts.delete(sessionId);
      void broadcastSnapshots(sessionId, false, guestIds);
    }, 40);
    timer.unref();
    pendingResponseBroadcasts.set(sessionId, { guestIds, timer });
  };

  app.get("/api/health", async () => ({
    status: databaseHandle.backupStatus.healthy ? "ok" : "degraded",
    backup: {
      healthy: databaseHandle.backupStatus.healthy,
      lastSuccessAt: databaseHandle.backupStatus.lastSuccessAt,
    },
  }));

  app.get("/api/public/sessions", async () => ({
    sessions: service.listLiveSessions(),
  }));

  app.post<{
    Params: { joinName: string };
    Body: { credentials?: GuestCredentials };
  }>(
    "/api/public/sessions/:joinName/join",
    {
      config: { rateLimit: { max: 1_000, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            credentials: {
              type: "object",
              additionalProperties: false,
              required: ["sessionId", "guestId", "secret"],
              properties: {
                sessionId: { type: "string", maxLength: 100 },
                guestId: { type: "string", maxLength: 100 },
                secret: { type: "string", maxLength: 100 },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const result = service.joinSession(
        request.params.joinName,
        request.body.credentials,
      );
      if (result.issued && result.credentials) {
        io.emit("sessions:changed");
        void broadcastSnapshots(result.credentials.sessionId, false);
      }
      return result;
    },
  );

  app.get<{ Params: { joinName: string } }>(
    "/api/public/sessions/:joinName/display",
    async (request) => {
      const session = service.publicSessionByJoinName(request.params.joinName);
      return service.displaySnapshot(session.id);
    },
  );

  app.post<{ Body: { password: string } }>(
    "/api/admin/login",
    {
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["password"],
          properties: { password: { type: "string", maxLength: 1_000 } },
        },
      },
    },
    async (request, reply) => {
      if (!auth.verifyPassword(request.body.password)) {
        throw new AppError(
          "invalid_password",
          "The presenter password is incorrect.",
          401,
        );
      }
      const adminSession = auth.createSession();
      reply.setCookie(ADMIN_COOKIE_NAME, adminSession.token, {
        path: "/",
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: "strict",
        maxAge: 24 * 60 * 60,
        expires: new Date(adminSession.expiresAt),
      });
      return { authenticated: true, expiresAt: adminSession.expiresAt };
    },
  );

  await app.register(
    async (admin) => {
      admin.addHook("onRequest", requireAdmin);

      admin.get("/me", async () => ({ authenticated: true }));

      admin.post("/logout", async (request, reply) => {
        const token = request.cookies[ADMIN_COOKIE_NAME];
        auth.invalidate(token);
        if (token) {
          const sockets = await io.fetchSockets();
          for (const socket of sockets) {
            if (
              socket.data.role === "admin" &&
              readCookie(socket.handshake.headers.cookie, ADMIN_COOKIE_NAME) ===
                token
            ) {
              socket.disconnect(true);
            }
          }
        }
        reply.clearCookie(ADMIN_COOKIE_NAME, { path: "/" });
        return { authenticated: false };
      });

      admin.get("/sessions", async () => ({
        sessions: service.listAdminSessions(),
      }));

      admin.get<{ Params: { sessionId: string } }>(
        "/sessions/:sessionId",
        async (request) => service.adminSnapshot(request.params.sessionId),
      );

      admin.post<{ Body: DraftSessionInput }>(
        "/sessions",
        { schema: { body: draftSchema } },
        async (request, reply) => {
          const session = service.createDraft(request.body);
          await reply.status(201).send(session);
        },
      );

      admin.put<{
        Params: { sessionId: string };
        Body: {
          session: DraftSessionInput;
          expectedControlRevision: number;
        };
      }>(
        "/sessions/:sessionId",
        {
          schema: {
            body: {
              type: "object",
              additionalProperties: false,
              required: ["session", "expectedControlRevision"],
              properties: {
                session: draftSchema,
                expectedControlRevision: { type: "integer", minimum: 0 },
              },
            },
          },
        },
        async (request) =>
          service.updateDraft(
            request.params.sessionId,
            request.body.session,
            request.body.expectedControlRevision,
          ),
      );

      admin.post<{
        Params: { sessionId: string };
        Body: { expectedControlRevision: number; requestId: string };
      }>(
        "/sessions/:sessionId/start",
        {
          schema: {
            body: {
              type: "object",
              additionalProperties: false,
              required: ["expectedControlRevision", "requestId"],
              properties: {
                expectedControlRevision: { type: "integer", minimum: 0 },
                requestId: { type: "string", minLength: 8, maxLength: 100 },
              },
            },
          },
        },
        async (request) => {
          const snapshot = service.startSession(
            request.params.sessionId,
            request.body.expectedControlRevision,
            request.body.requestId,
          );
          io.emit("sessions:changed");
          return snapshot;
        },
      );

      admin.post<{
        Params: { sessionId: string };
        Body: { joinName: string };
      }>(
        "/sessions/:sessionId/duplicate",
        {
          schema: {
            body: {
              type: "object",
              additionalProperties: false,
              required: ["joinName"],
              properties: { joinName: { type: "string", maxLength: 24 } },
            },
          },
        },
        async (request, reply) => {
          const duplicate = service.duplicateEndedSession(
            request.params.sessionId,
            request.body.joinName,
          );
          await reply.status(201).send(duplicate);
        },
      );

      admin.delete<{
        Params: { sessionId: string };
        Body: { confirmation?: string | boolean };
      }>(
        "/sessions/:sessionId",
        {
          schema: {
            body: {
              type: "object",
              additionalProperties: false,
              properties: {
                confirmation: { anyOf: [{ type: "string" }, { type: "boolean" }] },
              },
            },
          },
        },
        async (request, reply) => {
          service.deleteSession(
            request.params.sessionId,
            request.body.confirmation,
          );
          io.emit("sessions:changed");
          await reply.status(204).send();
        },
      );

      admin.get<{ Params: { sessionId: string } }>(
        "/sessions/:sessionId/export.csv",
        async (request, reply) => {
          const exported = service.exportCsv(request.params.sessionId);
          reply
            .type("text/csv; charset=utf-8")
            .header(
              "Content-Disposition",
              `attachment; filename="${exported.filename}"`,
            );
          return exported.csv;
        },
      );
    },
    { prefix: "/api/admin" },
  );

  const venueLimiter = new WindowRateLimiter(2_000, 60_000);
  const guestLimiter = new WindowRateLimiter(120, 60_000);
  const presenterLimiter = new WindowRateLimiter(120, 60_000);
  const socketSnapshotLimiter = new WindowRateLimiter(60, 60_000);

  const socketSnapshot = (
    socket: TypedSocket,
  ): ParticipantSnapshot | DisplaySnapshot | AdminSessionDetail => {
    if (!socket.data.sessionId || !socket.data.role) {
      throw new AppError(
        "not_subscribed",
        "Join a Voting Session first.",
        401,
      );
    }
    if (socket.data.role === "participant") {
      return service.participantSnapshot(
        socket.data.sessionId,
        socket.data.guestId ?? null,
      );
    }
    if (socket.data.role === "display") {
      return service.displaySnapshot(socket.data.sessionId);
    }
    if (
      !auth.isAuthenticated(
        readCookie(socket.handshake.headers.cookie, ADMIN_COOKIE_NAME),
      )
    ) {
      throw new AppError(
        "admin_required",
        "The presenter session has expired.",
        401,
      );
    }
    return service.adminSnapshot(socket.data.sessionId);
  };

  const requireRoomCapacity = (
    socket: TypedSocket,
    room: string,
    maximum: number,
  ): void => {
    const size = io.sockets.adapter.rooms.get(room)?.size ?? 0;
    if (!socket.rooms.has(room) && size >= maximum) {
      throw new AppError(
        "view_capacity_reached",
        "This view has too many connections. Try again shortly.",
        503,
      );
    }
  };

  io.on("connection", (socket: TypedSocket) => {
    const clientAddress = resolveClientAddress(
      socket.handshake.address,
      socket.handshake.headers["x-forwarded-for"],
    );
    socket.data.clientAddress = clientAddress;
    socket.on(
      "session:subscribe",
      async (request: SubscribeRequest, acknowledge) => {
        try {
          if (typeof acknowledge !== "function") return;
          if (
            !socketEventAddressLimiter.accept(clientAddress) ||
            !socketSnapshotLimiter.accept(socket.id)
          ) {
            throw new AppError(
              "rate_limited",
              "Please wait a moment before refreshing this view.",
              429,
            );
          }
          if (!isSubscribeRequest(request)) {
            throw new AppError("invalid_subscription", "Choose a valid view.");
          }
          const session = service.publicSessionByJoinName(request.joinName);
          let guestId: string | undefined;
          if (request.role === "participant" && session.status === "live") {
            guestId = service.verifyGuestCredentials(
              request.joinName,
              request.credentials,
            ).guestId;
          }
          if (
            request.role === "admin" &&
            !auth.isAuthenticated(
              readCookie(socket.handshake.headers.cookie, ADMIN_COOKIE_NAME),
            )
          ) {
            throw new AppError(
              "admin_required",
              "The presenter session has expired.",
              401,
            );
          }

          if (request.role === "participant") {
            requireRoomCapacity(
              socket,
              participantRoom(session.id),
              MAX_PARTICIPANT_SOCKETS_PER_SESSION,
            );
            if (guestId) {
              requireRoomCapacity(
                socket,
                guestRoom(session.id, guestId),
                MAX_PARTICIPANT_SOCKETS_PER_GUEST,
              );
            }
          } else if (request.role === "display") {
            requireRoomCapacity(
              socket,
              displayRoom(session.id),
              MAX_DISPLAY_SOCKETS_PER_SESSION,
            );
          } else {
            requireRoomCapacity(
              socket,
              adminRoom(session.id),
              MAX_ADMIN_SOCKETS_PER_SESSION,
            );
          }

          for (const room of socket.rooms) {
            if (room !== socket.id) await socket.leave(room);
          }
          socket.data = {
            role: request.role,
            sessionId: session.id,
            guestId,
            clientAddress,
          };
          if (request.role === "participant") {
            await socket.join(participantRoom(session.id));
            if (guestId) await socket.join(guestRoom(session.id, guestId));
          } else if (request.role === "display") {
            await socket.join(displayRoom(session.id));
          } else {
            await socket.join(adminRoom(session.id));
          }
          sendAcknowledgement(acknowledge, success(socketSnapshot(socket)));
        } catch (error) {
          sendAcknowledgement(acknowledge, failure(error));
        }
      },
    );

    socket.on("session:snapshot", (acknowledge) => {
      try {
        if (typeof acknowledge !== "function") return;
        if (
          !socketEventAddressLimiter.accept(clientAddress) ||
          !socketSnapshotLimiter.accept(socket.id)
        ) {
          throw new AppError(
            "rate_limited",
            "Please wait a moment before refreshing this view.",
            429,
          );
        }
        sendAcknowledgement(acknowledge, success(socketSnapshot(socket)));
      } catch (error) {
        sendAcknowledgement(acknowledge, failure(error));
      }
    });

    socket.on(
      "response:submit",
      async (submission: ResponseSubmission, acknowledge) => {
        try {
          if (!isResponseSubmission(submission)) {
            throw new AppError(
              "invalid_response",
              "Check the submitted response.",
            );
          }
          if (
            socket.data.role !== "participant" ||
            !socket.data.sessionId ||
            !socket.data.guestId
          ) {
            throw new AppError(
              "participant_required",
              "Join as a Participant before responding.",
              401,
            );
          }
          const address = socket.data.clientAddress ?? clientAddress;
          if (
            !venueLimiter.accept(address) ||
            !guestLimiter.accept(
              `${socket.data.sessionId}:${socket.data.guestId}`,
            )
          ) {
            throw new AppError(
              "rate_limited",
              "Please wait a moment before responding again.",
              429,
            );
          }
          const snapshot = service.submitResponse(
            socket.data.sessionId,
            socket.data.guestId,
            submission,
          );
          sendAcknowledgement(acknowledge, success(snapshot));
          scheduleResponseBroadcast(socket.data.sessionId, socket.data.guestId);
        } catch (error) {
          sendAcknowledgement(acknowledge, failure(error));
        }
      },
    );

    socket.on(
      "presenter:command",
      async (command: PresenterCommand, acknowledge) => {
        try {
          if (!isPresenterCommand(command)) {
            throw new AppError(
              "invalid_command",
              "Choose a valid Presenter action.",
            );
          }
          if (
            socket.data.role !== "admin" ||
            !socket.data.sessionId ||
            !auth.isAuthenticated(
              readCookie(socket.handshake.headers.cookie, ADMIN_COOKIE_NAME),
            )
          ) {
            throw new AppError(
              "admin_required",
              "The presenter session has expired.",
              401,
            );
          }
          if (!presenterLimiter.accept(socket.id)) {
            throw new AppError(
              "rate_limited",
              "Please wait a moment before using another control.",
              429,
            );
          }
          const snapshot = service.runPresenterCommand(
            socket.data.sessionId,
            command,
          );
          sendAcknowledgement(acknowledge, success(snapshot));
          await broadcastSnapshots(socket.data.sessionId, true);
          if (command.action === "end") io.emit("sessions:changed");
        } catch (error) {
          sendAcknowledgement(acknowledge, failure(error));
        }
      },
    );
  });

  if (config.serveClient) {
    await app.register(fastifyStatic, {
      root: resolve("dist/client"),
      wildcard: false,
    });
    app.setNotFoundHandler((request, reply) => {
      if (
        request.method === "GET" &&
        !request.url.startsWith("/api/") &&
        !request.url.startsWith("/socket.io/") &&
        request.headers.accept?.includes("text/html")
      ) {
        void reply.type("text/html").sendFile("index.html");
        return;
      }
      void reply.status(404).send({
        error: { code: "not_found", message: "Page not found." },
      });
    });
  }

  app.addHook("preClose", async () => {
    for (const pending of pendingResponseBroadcasts.values()) {
      clearTimeout(pending.timer);
    }
    pendingResponseBroadcasts.clear();
    await new Promise<void>((resolveClose) => io.close(() => resolveClose()));
  });

  app.addHook("onClose", async () => {
    await databaseHandle.close();
  });

  return { app, auth, io, service };
}
